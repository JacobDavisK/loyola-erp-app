import { api, body } from "@/server/api";
import { assertSee, isHostLike, loadMeeting } from "@/server/services/video/access";
import { cancelMeeting, updateMeeting } from "@/server/services/video/meetings";

type P = { id: string };

/** GET /api/video/meetings/:id — meeting details for people allowed to see it. */
export const GET = api<P>(async ({ ctx, params }) => {
  const m = await loadMeeting(params.id);
  await assertSee(ctx, m);
  return {
    id: m.id, publicId: m.publicId, title: m.title, description: m.description, type: m.meetingType, status: m.status, visibility: m.visibility,
    scheduledStart: m.scheduledStart, scheduledEnd: m.scheduledEnd, actualStart: m.actualStart, actualEnd: m.actualEnd, timezone: m.timezone,
    lobbyEnabled: m.lobbyEnabled, recordingEnabled: m.recordingEnabled, chatEnabled: m.chatEnabled, screenShareEnabled: m.screenShareEnabled, isHost: isHostLike(ctx, m),
  };
});

/** PATCH /api/video/meetings/:id — reschedule or change settings (host, before it starts). */
export const PATCH = api<P>(async ({ ctx, params, req }) => {
  await updateMeeting(ctx, params.id, await body(req));
  return { ok: true };
});

/** DELETE /api/video/meetings/:id { reason } — cancel. Records are kept. */
export const DELETE = api<P>(async ({ ctx, params, req }) => {
  const b = (await body(req)) as { reason?: string };
  await cancelMeeting(ctx, params.id, b.reason ?? "");
  return { ok: true };
});
