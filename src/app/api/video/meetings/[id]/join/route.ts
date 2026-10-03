import { api } from "@/server/api";
import { joinMeeting } from "@/server/services/video/meetings";

/** POST /api/video/meetings/:id/join — a short-lived join token, or { status: lobby | waiting }. */
export const POST = api<{ id: string }>(async ({ ctx, params }) => joinMeeting(ctx, params.id));
