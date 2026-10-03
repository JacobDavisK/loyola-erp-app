import { api, body } from "@/server/api";
import { addParticipants, participantsView } from "@/server/services/video/meetings";

type P = { id: string };

/** GET — participants with live status (everyone for hosts and moderators; people in the room otherwise). */
export const GET = api<P>(async ({ ctx, params }) => {
  const v = await participantsView(ctx, params.id);
  return { moderator: v.moderator, participants: v.rows };
});

/** POST { userIds, role } — invite more people (host). */
export const POST = api<P>(async ({ ctx, params, req }) => ({ added: await addParticipants(ctx, params.id, await body(req)) }));
