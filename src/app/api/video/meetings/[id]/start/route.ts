import { api } from "@/server/api";
import { startMeeting } from "@/server/services/video/meetings";

/** POST /api/video/meetings/:id/start — host or co-host starts the meeting. */
export const POST = api<{ id: string }>(async ({ ctx, params }) => {
  const m = await startMeeting(ctx, params.id);
  return { status: m.status };
});
