import { api } from "@/server/api";
import { revokeGuest } from "@/server/services/video/meetings";

export const DELETE = api<{ id: string; gid: string }>(async ({ ctx, params }) => {
  await revokeGuest(ctx, params.id, params.gid);
  return { ok: true };
});
