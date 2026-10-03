import { api, body } from "@/server/api";
import { deleteRecording, playbackUrl, updateRecording } from "@/server/services/video/recordings";

type P = { rid: string };
/** GET ?download=1 — a short-lived playback address bound to the caller. */
export const GET = api<P>(async ({ ctx, params, req }) => ({ url: await playbackUrl(ctx, params.rid, req.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline") }));
/** PATCH { access, allowedUserIds, archived } — share or archive (host or authorised staff). */
export const PATCH = api<P>(async ({ ctx, params, req }) => {
  await updateRecording(ctx, params.rid, await body(req));
  return { ok: true };
});
/** DELETE { reason } — needs video.delete_recording. */
export const DELETE = api<P>(async ({ ctx, params, req }) => {
  const b = (await body(req)) as { reason?: string };
  await deleteRecording(ctx, params.rid, b.reason ?? "");
  return { ok: true };
});
