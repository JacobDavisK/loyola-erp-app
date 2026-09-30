"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAuth } from "@/server/auth/current";
import { saveTemplate, saveWatermark } from "@/server/services/templates";

export async function saveTemplateAction(id: string | null, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("admin.templates.manage");
    await saveTemplate(ctx, id, input);
    revalidatePath("/templates");
  }, "Template saved");
}

export async function saveWatermarkAction(id: string | null, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("admin.templates.manage");
    await saveWatermark(ctx, id, input);
    revalidatePath("/templates");
  }, "Watermark saved");
}
