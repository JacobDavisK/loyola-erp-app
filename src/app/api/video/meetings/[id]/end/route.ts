import { api } from "@/server/api";
import { endMeeting } from "@/server/services/video/meetings";

/** POST /api/video/meetings/:id/end — host or co-host ends the meeting for everyone. */
export const POST = api<{ id: string }>(async ({ ctx, params }) => {
  await endMeeting(ctx, params.id);
  return { ok: true };
});
