import { api } from "@/server/api";
import { recordingsFor, startRecording } from "@/server/services/video/recordings";

type P = { id: string };
/** GET — recordings the caller may watch (never storage addresses). */
export const GET = api<P>(async ({ ctx, params }) => {
  const { recordings, manage } = await recordingsFor(ctx, params.id);
  return { manage, recordings: recordings.map((r) => ({ id: r.id, status: r.status, access: r.access, startedAt: r.startedAt, endedAt: r.endedAt, durationSeconds: r.durationSeconds, fileSize: r.fileSize === null ? null : Number(r.fileSize) })) };
});
/** POST — start recording (host). */
export const POST = api<P>(async ({ ctx, params }) => {
  const r = await startRecording(ctx, params.id);
  return { id: r.id, status: r.status };
});
