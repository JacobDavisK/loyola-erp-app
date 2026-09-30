"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAuth } from "@/server/auth/current";
import { archiveBlueprint, duplicateBlueprint, saveBlueprint } from "@/server/services/blueprints";

export async function saveBlueprintAction(id: string | null, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("blueprint.manage");
    const bp = await saveBlueprint(ctx, id, input);
    revalidatePath("/blueprints");
    return { id: bp.id };
  }, "Blueprint saved");
}

export async function duplicateBlueprintAction(id: string) {
  return runAction(async () => {
    const ctx = await requireAuth("blueprint.manage");
    const bp = await duplicateBlueprint(ctx, id);
    revalidatePath("/blueprints");
    return { id: bp.id };
  }, "Blueprint duplicated");
}

export async function archiveBlueprintAction(id: string) {
  return runAction(async () => {
    const ctx = await requireAuth("blueprint.manage");
    await archiveBlueprint(ctx, id);
    revalidatePath("/blueprints");
  }, "Blueprint archived");
}
