import { NextResponse } from "next/server";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * POST /api/media
 *
 * Accepts a multipart form-data upload with a single `file` field.
 * Validates MIME type and file size, then returns the CDN URL of the
 * stored image.
 *
 * In production, replace the stub URL construction with an actual
 * object-storage upload (e.g. Cloudflare R2, AWS S3, or a dedicated
 * media service) and stream the file bytes there before responding.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data" }, { status: 400 });
  }

  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing required field: file" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      {
        error: `Unsupported file type: ${file.type}. Allowed types: ${ALLOWED_TYPES.join(", ")}`,
      },
      { status: 415 }
    );
  }

  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      {
        error: `File too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum allowed size is ${MAX_SIZE_BYTES / (1024 * 1024)} MB.`,
      },
      { status: 413 }
    );
  }

  // TODO: Replace stub with real object-storage upload (R2 / S3).
  // Returns a deterministic stub URL so upstream consumers have a concrete
  // string to work with during development.
  const ext = file.name.split(".").pop() ?? "bin";
  const key = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const cdnBase = process.env.CDN_BASE_URL ?? "https://cdn.linkora.social";
  const url = `${cdnBase}/media/${key}`;

  return NextResponse.json({ url }, { status: 201 });
}
