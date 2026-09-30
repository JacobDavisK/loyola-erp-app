import { api, body } from "@/server/api";
import { audit } from "@/server/services/audit";
import { availableActions, paperForUser, savePaperStructure, snapshotOf } from "@/server/services/papers";

/** GET /api/papers/:id — paper snapshot (content) for authorised viewers; access is audited. */
export const GET = api<{ id: string }>(async ({ ctx, params }) => {
  const { paper, caps } = await paperForUser(ctx, params.id);
  const [snapshot, actions] = await Promise.all([snapshotOf(params.id), availableActions(ctx, params.id)]);
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "paper.access", resourceType: "paper", resourceId: params.id, summary: "Read via API" });
  return { id: paper.id, status: paper.status, revision: paper.revision, capabilities: caps, actions, snapshot };
});

/** PUT /api/papers/:id — replace structure (setter, editable states only; optimistic concurrency via `revision`). */
export const PUT = api<{ id: string }>(async ({ req, ctx, params }) => savePaperStructure(ctx, params.id, await body(req)));
