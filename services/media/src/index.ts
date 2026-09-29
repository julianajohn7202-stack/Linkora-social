/**
 * @linkora/media
 *
 * Upload, transcoding, and CDN management service for creator content on the
 * Linkora SocialFi platform.  Handles image and video ingestion, generates
 * thumbnails, and returns content-addressed CDN URLs.
 *
 * This file is a stub — implementation will be added in follow-up PRs.
 */

export type MediaKind = "image" | "video" | "audio" | "document";

export type MediaStatus = "pending" | "processing" | "ready" | "error";

export interface MediaAsset {
  /** Unique identifier (UUID v4) */
  id: string;
  /** Uploader Stellar account address */
  ownerAddress: string;
  kind: MediaKind;
  status: MediaStatus;
  /** Original filename provided by the uploader */
  originalFilename: string;
  /** MIME type detected at upload time */
  mimeType: string;
  /** File size in bytes */
  sizeBytes: number;
  /** Public CDN URL, available when status === "ready" */
  cdnUrl?: string;
  /** Unix timestamp (ms) of the upload request */
  createdAt: number;
}

export interface UploadRequest {
  ownerAddress: string;
  kind: MediaKind;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface MediaService {
  initiateUpload(req: UploadRequest): Promise<{ asset: MediaAsset; uploadUrl: string }>;
  getAsset(id: string): Promise<MediaAsset | null>;
  deleteAsset(id: string, ownerAddress: string): Promise<void>;
}

/**
 * No-op implementation used during development and tests.
 */
export class NoopMediaService implements MediaService {
  async initiateUpload(req: UploadRequest): Promise<{ asset: MediaAsset; uploadUrl: string }> {
    // TODO: generate pre-signed upload URL and persist asset record
    const asset: MediaAsset = {
      id: "00000000-0000-0000-0000-000000000000",
      ownerAddress: req.ownerAddress,
      kind: req.kind,
      status: "pending",
      originalFilename: req.originalFilename,
      mimeType: req.mimeType,
      sizeBytes: req.sizeBytes,
      createdAt: Date.now(),
    };
    return { asset, uploadUrl: "" };
  }

  async getAsset(_id: string): Promise<MediaAsset | null> {
    // TODO: fetch from database
    return null;
  }

  async deleteAsset(_id: string, _ownerAddress: string): Promise<void> {
    // TODO: remove asset record and CDN object
  }
}
