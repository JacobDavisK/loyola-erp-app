import { api, body } from "@/server/api";
import { addMeetingNote, meetingNotes } from "@/server/services/video/meetings";

type P = { id: string };
/** Panel notes (viva, PhD review, mentoring): never visible to the candidate. */
export const GET = api<P>(async ({ ctx, params }) => meetingNotes(ctx, params.id));
export const POST = api<P>(async ({ ctx, params, req }) => addMeetingNote(ctx, params.id, await body(req)));
