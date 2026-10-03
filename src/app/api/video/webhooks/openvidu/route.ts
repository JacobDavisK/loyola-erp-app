import { NextResponse, type NextRequest } from "next/server";
import { hit } from "@/server/security/rate-limit";
import { receiveVideoWebhook } from "@/server/services/video/webhooks";

/**
 * POST /api/video/webhooks/openvidu — OpenVidu event delivery (content type application/webhook+json).
 * Authenticated by the signed JWT in the Authorization header (verified against the API secret and the
 * body's SHA-256); duplicates are acknowledged without being applied twice. A non-2xx reply makes
 * OpenVidu retry with backoff, which is what we want when processing fails.
 */
export async function POST(req: NextRequest) {
  if (!hit(`video-webhook:${req.headers.get("x-forwarded-for") ?? "local"}`, 600, 60_000)) return NextResponse.json({ error: "rate limited" }, { status: 429 });
  const raw = await req.text();
  if (raw.length > 256_000) return NextResponse.json({ error: "too large" }, { status: 413 });
  try {
    const out = await receiveVideoWebhook(raw, req.headers.get("authorization"));
    if (out.status === "rejected") return NextResponse.json({ error: "unauthorised" }, { status: 401 });
    return NextResponse.json({ status: out.status });
  } catch {
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
