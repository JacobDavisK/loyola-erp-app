import { api } from "@/server/api";
import { deleteChat } from "@/server/services/video/chat";

export const DELETE = api<{ id: string; mid: string }>(async ({ ctx, params }) => {
  await deleteChat(ctx, params.id, params.mid);
  return { ok: true };
});
