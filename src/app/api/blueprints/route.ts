import { api, body } from "@/server/api";
import { db } from "@/server/db";
import { saveBlueprint } from "@/server/services/blueprints";

export const GET = api(async () => db.blueprint.findMany({ where: { deletedAt: null }, include: { sections: { orderBy: { order: "asc" } }, rules: true }, orderBy: { name: "asc" } }), { perm: "blueprint.view" });

export const POST = api(async ({ req, ctx }) => {
  const bp = await saveBlueprint(ctx, null, await body(req));
  return { id: bp.id };
}, { perm: "blueprint.manage" });
