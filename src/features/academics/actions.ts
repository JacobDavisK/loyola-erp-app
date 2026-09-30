"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAuth } from "@/server/auth/current";
import { archiveCourse, saveCourse, saveStructure, type StructureKind } from "@/server/services/academics";

export async function saveCourseAction(id: string | null, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("academic.manage");
    const c = await saveCourse(ctx, id, input);
    revalidatePath("/academics/courses");
    return { id: c.id };
  }, "Course saved");
}

export async function archiveCourseAction(id: string) {
  return runAction(async () => {
    const ctx = await requireAuth("academic.manage");
    await archiveCourse(ctx, id);
    revalidatePath("/academics/courses");
  }, "Course archived");
}

export async function saveStructureAction(kind: StructureKind, id: string | null, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("academic.manage");
    await saveStructure(ctx, kind, id, input);
    revalidatePath("/academics/structure");
  }, "Saved");
}
