import { NextResponse } from "next/server";
import { getAuth } from "@/server/auth/current";
import { isAppError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { meetingsCsv } from "@/server/services/video/analytics";

/** GET /api/video/analytics/export — meetings the viewer oversees, as CSV (audited). */
export async function GET() {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  try {
    const csv = await meetingsCsv(ctx);
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "video.analytics.export", resourceType: "videoMeeting", summary: "Meetings exported (CSV)" });
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="video-meetings-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (isAppError(e)) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
