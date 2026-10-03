import { api, body } from "@/server/api";
import { adjustAttendance } from "@/server/services/video/attendance";

/** PATCH { status, reason } — correct attendance (video.modify_attendance; audited). */
export const PATCH = api<{ id: string; aid: string }>(async ({ ctx, params, req }) => {
  await adjustAttendance(ctx, params.aid, await body(req));
  return { ok: true };
});
