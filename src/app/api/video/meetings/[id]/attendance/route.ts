import { NextResponse, type NextRequest } from "next/server";
import { api } from "@/server/api";
import { getAuth } from "@/server/auth/current";
import { isAppError } from "@/server/errors";
import { attendanceCsv, meetingAttendance } from "@/server/services/video/attendance";

type P = { id: string };

const json = api<P>(async ({ ctx, params }) => {
  const a = await meetingAttendance(ctx, params.id);
  return { canAdjust: a.canAdjust, rows: a.rows.map((r) => ({ id: r.id, name: r.participant.displayName, role: r.participant.role, minutes: Math.round(r.totalSeconds / 60), percentage: r.attendancePercentage, status: r.attendanceStatus, firstJoinedAt: r.firstJoinedAt, lastLeftAt: r.lastLeftAt, manuallyAdjusted: r.manuallyAdjusted, reason: r.adjustmentReason })) };
});

/** GET /api/video/meetings/:id/attendance[?format=csv] — everyone's for hosts and oversight, one's own otherwise. */
export async function GET(req: NextRequest, route: { params: Promise<P> }) {
  if (req.nextUrl.searchParams.get("format") !== "csv") return json(req, route);
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  try {
    const a = await meetingAttendance(ctx, (await route.params).id);
    return new NextResponse(attendanceCsv(a.rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="attendance-${a.meeting.publicId}.csv"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (isAppError(e)) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
