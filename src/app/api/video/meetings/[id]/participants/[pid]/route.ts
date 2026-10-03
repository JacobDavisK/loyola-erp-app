import { api, body } from "@/server/api";
import { z } from "zod";
import { decideLobby, muteParticipant, removeParticipant, setParticipantRole } from "@/server/services/video/meetings";

type P = { id: string; pid: string };
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("role"), role: z.enum(["CO_HOST", "PRESENTER", "PARTICIPANT", "MODERATOR", "OBSERVER"]) }),
  z.object({ action: z.literal("mute"), kind: z.enum(["audio", "video", "all"]).default("audio") }),
  z.object({ action: z.literal("admit") }),
  z.object({ action: z.literal("deny") }),
]);

/** PATCH { action: role | mute | admit | deny } — host controls, authorised on the server for every call. */
export const PATCH = api<P>(async ({ ctx, params, req }) => {
  const a = action.parse(await body(req));
  if (a.action === "role") await setParticipantRole(ctx, params.id, params.pid, a.role);
  else if (a.action === "mute") await muteParticipant(ctx, params.id, params.pid, a.kind);
  else await decideLobby(ctx, params.id, params.pid, a.action === "admit");
  return { ok: true };
});

/** DELETE — remove from the meeting (they cannot rejoin). */
export const DELETE = api<P>(async ({ ctx, params }) => {
  await removeParticipant(ctx, params.id, params.pid);
  return { ok: true };
});
