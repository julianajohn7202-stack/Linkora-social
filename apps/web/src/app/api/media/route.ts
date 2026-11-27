import { createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { buildAuthMessage } from "@linkora/types/src/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SIGNATURE_LIFETIME_MS = 30_000;
const usedSignatures = new Map<string, number>();

function authenticate(header: string | null, bodyHash: string): boolean {
  const encoded = /^StellarSig ([A-Za-z0-9+/]+={0,2})$/.exec(header ?? "")?.[1];
  if (!encoded || encoded.length > 512 || !/^[a-f0-9]{64}$/.test(bodyHash)) return false;

  try {
    const { address, timestamp, signature } = JSON.parse(Buffer.from(encoded, "base64").toString());
    const now = Date.now();
    if (
      typeof address !== "string" ||
      !Number.isSafeInteger(timestamp) ||
      timestamp > now ||
      now - timestamp >= SIGNATURE_LIFETIME_MS ||
      typeof signature !== "string"
    ) {
      return false;
    }

    const signatureBytes = Buffer.from(signature, "base64");
    if (signatureBytes.length !== 64) return false;

    const message = buildAuthMessage({
      method: "POST",
      canonicalPath: "/api/media",
      address,
      timestamp,
      bodyHash,
    });
    const hash = createHash("sha256").update(message).digest();
    if (!Keypair.fromPublicKey(address).verify(hash, signatureBytes)) return false;

    for (const [key, expiresAt] of usedSignatures) {
      if (expiresAt <= now) usedSignatures.delete(key);
    }
    const key = signatureBytes.toString("base64");
    if (usedSignatures.has(key)) return false;
    usedSignatures.set(key, timestamp + SIGNATURE_LIFETIME_MS);
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const fileHash = request.headers.get("x-media-sha256") ?? "";
  if (!authenticate(request.headers.get("authorization"), fileHash)) {
    return NextResponse.json({ error: "Valid Stellar authorization is required" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type");
  if (!contentType || !/^multipart\/form-data\s*;/i.test(contentType)) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 415 });
  }
  if (!request.body) {
    return NextResponse.json({ error: "Missing upload body" }, { status: 400 });
  }

  const serviceUrl = process.env.MEDIA_SERVICE_URL;
  const serviceToken = process.env.MEDIA_UPLOAD_TOKEN;
  if (!serviceUrl || !serviceToken) {
    return NextResponse.json({ error: "Media service is unavailable" }, { status: 503 });
  }

  try {
    const headers = new Headers({
      authorization: `Bearer ${serviceToken}`,
      "content-type": contentType,
      "x-media-sha256": fileHash,
    });
    const length = request.headers.get("content-length");
    if (length) headers.set("content-length", length);
    const upload: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers,
      body: request.body,
      duplex: "half",
      redirect: "error",
      signal: request.signal,
    };
    const response = await fetch(new URL("/upload", serviceUrl), upload);

    return new NextResponse(response.body, {
      status: response.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Media service request failed" }, { status: 502 });
  }
}
