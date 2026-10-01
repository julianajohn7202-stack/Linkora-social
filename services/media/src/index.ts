/**
 * @linkora/media
 *
 * Upload, transcode, and serve creator media assets (avatars, cover images,
 * post attachments) for the Linkora social protocol. Stores originals on
 * S3-compatible object storage and serves resized variants via CDN.
 *
 * This service is a stub — full implementation is tracked in the project
 * roadmap.
 */

export type MediaType = "image" | "video" | "audio" | "document";

export type MediaStatus = "pending" | "processing" | "ready" | "failed";

export interface MediaAsset {
  /** Unique asset identifier (UUID). */
  id: string;
  /** Stellar address of the uploader. */
  uploader: string;
  mediaType: MediaType;
  status: MediaStatus;
  /** Original filename as provided by the client. */
  originalFilename: string;
  /** MIME type detected at upload time. */
  mimeType: string;
  /** Size in bytes of the original file. */
  sizeBytes: number;
  /** Public URL of the processed/CDN-served asset. Null until status = "ready". */
  publicUrl: string | null;
  /** ISO-8601 timestamp of upload. */
  uploadedAt: string;
}

export interface UploadRequest {
  uploader: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Create a new media asset record and return a presigned upload URL.
 *
 * Stub: always returns a placeholder presigned URL without writing to any
 * storage backend.
 *
 * @param request - Upload metadata from the client.
 * @returns The created {@link MediaAsset} and a presigned upload URL.
 */
export async function createUpload(
  request: UploadRequest
): Promise<{ asset: MediaAsset; presignedUrl: string }> {
  const asset: MediaAsset = {
    id: `stub-${Date.now()}`,
    uploader: request.uploader,
    mediaType: mimeToMediaType(request.mimeType),
    status: "pending",
    originalFilename: request.originalFilename,
    mimeType: request.mimeType,
    sizeBytes: request.sizeBytes,
    publicUrl: null,
    uploadedAt: new Date().toISOString(),
  };

  console.log(`[media] createUpload asset=${asset.id}`, request);
  return { asset, presignedUrl: `https://stub.example.com/upload/${asset.id}` };
}

function mimeToMediaType(mimeType: string): MediaType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}
