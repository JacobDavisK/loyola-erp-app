import { api, body } from "@/server/api";
import { createGuestInvite } from "@/server/services/video/meetings";

/** POST { name, email, role, panelRole } — a meeting-specific, time-limited guest link (shown once). */
export const POST = api<{ id: string }>(async ({ ctx, params, req }) => createGuestInvite(ctx, params.id, await body(req)));
