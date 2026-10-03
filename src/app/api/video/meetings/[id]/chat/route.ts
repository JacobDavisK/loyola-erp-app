import { api, body } from "@/server/api";
import { chatHistory, postChat } from "@/server/services/video/chat";

type P = { id: string };
export const GET = api<P>(async ({ ctx, params }) => chatHistory(ctx, params.id));
/** POST { message } — sent through the ERP, stored and relayed to the room. */
export const POST = api<P>(async ({ ctx, params, req }) => postChat(ctx, params.id, await body(req)));
