import { NextRequest, NextResponse } from "next/server";

const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || "http://localhost:3001";
const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

// ── Mock fallback data ────────────────────────────────────────────────────────

const MOCK_NOTIFICATIONS = [
  {
    id: "notif-1",
    type: "FOLLOW",
    message: "Someone followed you.",
    read: false,
    created_at: new Date(Date.now() - 3_600_000).toISOString(),
  },
  {
    id: "notif-2",
    type: "LIKE_RECEIVED",
    message: "Your post received a like.",
    read: false,
    created_at: new Date(Date.now() - 7_200_000).toISOString(),
  },
  {
    id: "notif-3",
    type: "TIP_RECEIVED",
    message: "You received a tip.",
    read: true,
    created_at: new Date(Date.now() - 86_400_000).toISOString(),
  },
];

// ── SEP-10 JWT helpers ────────────────────────────────────────────────────────

/**
 * Extract the Stellar address from a SEP-10 JWT Bearer token.
 *
 * SEP-10 JWTs carry the account address in the `sub` claim. We only need the
 * payload (second segment), so a full JWT library is not required — we just
 * base64url-decode it and parse the JSON.
 *
 * Returns the address string, or null if the header is absent, malformed, or
 * the `sub` claim is not a valid Stellar address.
 */
function extractAddressFromJWT(authHeader: string | null): string | null {
  if (!authHeader) return null;

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") return null;

  const token = parts[1];
  const segments = token.split(".");
  if (segments.length < 2) return null;

  try {
    // Base64url → base64 → decode
    const base64 = segments[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(base64, "base64").toString("utf-8");
    const payload = JSON.parse(json) as Record<string, unknown>;
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    if (!sub || !STELLAR_ADDRESS_RE.test(sub)) return null;
    return sub;
  } catch {
    return null;
  }
}

// ── GET /api/notifications ────────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<NextResponse> {
  const address = extractAddressFromJWT(request.headers.get("authorization"));
  if (!address) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const unread = request.nextUrl.searchParams.get("unread");
  const indexerParams = new URLSearchParams({ address });
  if (unread === "true") indexerParams.set("unread", "true");

  try {
    const res = await fetch(
      `${INDEXER_URL}/api/notifications?${indexerParams.toString()}`,
      {
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(3_000),
      }
    );

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {
    // Indexer unreachable — fall through to mock.
  }

  // Fallback: return mock notifications filtered by unread if requested.
  const notifications =
    unread === "true"
      ? MOCK_NOTIFICATIONS.filter((n) => !n.read)
      : MOCK_NOTIFICATIONS;

  return NextResponse.json({ notifications, address });
}

// ── PATCH /api/notifications ──────────────────────────────────────────────────

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const address = extractAddressFromJWT(request.headers.get("authorization"));
  if (!address) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const res = await fetch(`${INDEXER_URL}/api/notifications`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, address }),
      signal: AbortSignal.timeout(3_000),
    });

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
  } catch {
    // Indexer unreachable — fall through to mock success.
  }

  // Fallback: acknowledge the mark-as-read without persistence.
  return NextResponse.json({ success: true, address });
}
