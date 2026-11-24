import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { encode } from "blurhash";
import Busboy from "busboy";
import type { Request, Response } from "express";
import sharp from "sharp";
import { createCdnUrl } from "./cdn";
import { MAX_FILE_SIZE_BYTES, MediaValidationError, validateMediaFile } from "./validation";

const MAX_MULTIPART_BYTES = MAX_FILE_SIZE_BYTES + 64 * 1024;
const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const endpoint = process.env.MEDIA_ENDPOINT || undefined;
const accessKeyId = process.env.MEDIA_ACCESS_KEY;
const secretAccessKey = process.env.MEDIA_SECRET_KEY;
const storage = new S3Client({
  endpoint,
  region: process.env.MEDIA_REGION || process.env.AWS_REGION || (endpoint ? "auto" : "us-east-1"),
  forcePathStyle: Boolean(endpoint),
  credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
  requestChecksumCalculation: "WHEN_REQUIRED",
});

function hash(value: string) {
  return createHash("sha256").update(value).digest();
}

async function receiveFile(req: Request, path: string, expectedHash: string) {
  if (!req.is("multipart/form-data")) {
    throw new MediaValidationError("Expected multipart/form-data", 415);
  }

  if (Number(req.get("content-length")) > MAX_MULTIPART_BYTES) {
    throw new MediaValidationError("Upload exceeds the 10 MB size limit", 413);
  }

  let parser;
  try {
    parser = Busboy({
      headers: req.headers,
      limits: { fileSize: MAX_FILE_SIZE_BYTES + 1, files: 1, fields: 0, parts: 2 },
      preservePath: true,
    });
  } catch {
    throw new MediaValidationError("Invalid multipart upload", 400);
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  req.once("close", onClose);
  function onClose() {
    if (!req.complete) abort();
  }
  const digest = createHash("sha256");
  let written: Promise<void> | undefined;
  let writeError: unknown;
  let fileInfo: { filename: string; mimeType: string } | undefined;
  let invalidParts = false;
  let fileTooLarge = false;
  parser.on("filesLimit", () => {
    invalidParts = true;
  });
  parser.on("fieldsLimit", () => {
    invalidParts = true;
  });
  parser.on("partsLimit", () => {
    invalidParts = true;
  });
  parser.on("file", (name, stream, info) => {
    if (name !== "file") {
      invalidParts = true;
      stream.resume();
      return;
    }
    fileInfo = info;
    stream.on("limit", () => {
      fileTooLarge = true;
    });
    const hashFile = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        digest.update(chunk);
        callback(null, chunk);
      },
    });
    written = pipeline(stream, hashFile, createWriteStream(path), {
      signal: controller.signal,
    }).catch((error: unknown) => {
      if (!controller.signal.aborted && !parser.destroyed) writeError = error;
      abort();
    });
  });

  let bytes = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > MAX_MULTIPART_BYTES) {
        callback(new MediaValidationError("Upload exceeds the 10 MB size limit", 413));
      } else {
        callback(null, chunk);
      }
    },
  });
  const parsing = pipeline(limit, parser, { signal: controller.signal });
  req.pipe(limit);
  try {
    await parsing;
    await written;
  } catch (error) {
    abort();
    await written;
    if (error instanceof MediaValidationError) throw error;
    if (writeError) throw writeError;
    throw new MediaValidationError("Incomplete or invalid multipart upload", 400);
  } finally {
    req.removeListener("close", onClose);
    req.unpipe(limit);
    if (!req.complete && !req.destroyed) req.resume();
  }

  if (fileTooLarge) throw new MediaValidationError("File exceeds the 10 MB size limit", 413);
  if (invalidParts || !fileInfo) throw new MediaValidationError("Expected one file field", 400);
  if (!Object.prototype.hasOwnProperty.call(EXTENSIONS, fileInfo.mimeType)) {
    throw new MediaValidationError("Unsupported media type", 415);
  }
  if (digest.digest("hex") !== expectedHash) {
    throw new MediaValidationError("File does not match the authorized upload", 401);
  }
  return fileInfo;
}

async function describeImage(path: string, mimeType: string) {
  try {
    const image = sharp(path, { limitInputPixels: 40_000_000 });
    const { width, height, orientation, format } = await image.metadata();
    if (!width || !height || `image/${format}` !== mimeType) {
      throw new Error("Invalid image metadata");
    }

    const { data, info } = await image
      .rotate()
      .resize(32, 32, { fit: "inside" })
      .toColourspace("srgb")
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const rotated = orientation !== undefined && orientation >= 5 && orientation <= 8;
    return {
      width: rotated ? height : width,
      height: rotated ? width : height,
      blurhash: encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3),
    };
  } catch {
    throw new MediaValidationError("Invalid or unreadable image", 415);
  }
}

export async function uploadMedia(req: Request, res: Response): Promise<void> {
  const token = process.env.MEDIA_UPLOAD_TOKEN;
  const bucket = process.env.MEDIA_BUCKET;
  if (!token || !bucket || !process.env.CDN_BASE_URL) {
    res.status(503).json({ error: "Media storage is unavailable" });
    return;
  }

  const fileHash = req.get("x-media-sha256") ?? "";
  if (
    !timingSafeEqual(hash(req.get("authorization") ?? ""), hash(`Bearer ${token}`)) ||
    !/^[a-f0-9]{64}$/.test(fileHash)
  ) {
    res.status(401).json({ error: "Upload authorization is required" });
    return;
  }

  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "linkora-media-"));
    const path = join(directory, "upload");
    const { filename, mimeType } = await receiveFile(req, path, fileHash);

    const file = await open(path, "r");
    let signature: Buffer;
    try {
      const { buffer, bytesRead } = await file.read(Buffer.alloc(12), 0, 12, 0);
      signature = buffer.subarray(0, bytesRead);
    } finally {
      await file.close();
    }
    if (validateMediaFile(signature, filename).mimeType !== mimeType) {
      throw new MediaValidationError("Image bytes do not match the declared media type", 415);
    }

    const metadata = await describeImage(path, mimeType);
    const key = `${randomUUID()}.${EXTENSIONS[mimeType]}`;
    const url = createCdnUrl(key, true);
    const { size } = await stat(path);
    const body = createReadStream(path);
    try {
      await storage.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentLength: size,
          ContentType: mimeType,
        })
      );
    } finally {
      body.destroy();
    }

    res.status(201).json({ url, ...metadata });
  } catch (error) {
    if (error instanceof MediaValidationError) {
      res.status(error.statusCode).json({ error: error.message });
    } else {
      console.error("[media] upload failed", error);
      res.status(502).json({ error: "Media upload failed" });
    }
  } finally {
    if (directory) {
      await rm(directory, { recursive: true, force: true }).catch((error: unknown) => {
        console.error("[media] temporary upload cleanup failed", error);
      });
    }
  }
}
