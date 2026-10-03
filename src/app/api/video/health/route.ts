import { NextResponse } from "next/server";
import { getAuth, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { videoProvider } from "@/server/video/provider";
import { recordingStorage } from "@/server/video/recording-storage";

/**
 * GET /api/video/health — whether video meetings can run. Public answer: ok / degraded only.
 * Administrators (video.view_analytics) also get the component states and recent webhook health.
 * Never includes addresses, keys or secrets.
 */
export async function GET() {
  const provider = await videoProvider();
  const h = await provider.health();
  const status = !provider.configured ? "not_configured" : h.ok ? "ok" : "degraded";
  const ctx = await getAuth();
  if (!ctx || !can(ctx, "video.view_analytics")) return NextResponse.json({ status }, { status: status === "degraded" ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  const since = new Date(Date.now() - 24 * 3_600_000);
  const [received, failed] = await Promise.all([
    db.videoWebhookEvent.count({ where: { createdAt: { gte: since } } }),
    db.videoWebhookEvent.count({ where: { createdAt: { gte: since }, processedAt: null } }),
  ]);
  return NextResponse.json({
    status,
    provider: { name: provider.name, configured: provider.configured, reachable: h.ok, latencyMs: h.latencyMs ?? null },
    recordingStorage: { name: recordingStorage().name, configured: recordingStorage().configured },
    webhooksLast24h: { received, unprocessed: failed },
  }, { headers: { "Cache-Control": "no-store" } });
}
