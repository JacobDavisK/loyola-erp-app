import { api } from "@/server/api";
import { stopRecording } from "@/server/services/video/recordings";

export const POST = api<{ id: string }>(async ({ ctx, params }) => {
  await stopRecording(ctx, params.id);
  return { ok: true };
});
