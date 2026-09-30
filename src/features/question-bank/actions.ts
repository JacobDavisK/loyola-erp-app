"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction } from "@/server/action";
import { requireAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { invalid } from "@/server/errors";
import { assertRate } from "@/server/security/rate-limit";
import { audit } from "@/server/services/audit";
import { createQuestion, findSimilarQuestions, setQuestionStatus, updateQuestion } from "@/server/services/questions";
import { saveFile, signedAssetUrl } from "@/server/storage";

export async function createQuestionAction(input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("question.create");
    const q = await createQuestion(ctx, input);
    revalidatePath("/question-bank");
    return { id: q.id, code: q.code, status: q.status };
  });
}

export async function updateQuestionAction(id: string, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth();
    const q = await updateQuestion(ctx, id, input);
    revalidatePath(`/question-bank/${id}`);
    return { id: q.id, version: q.currentVersion };
  }, "Saved as a new version");
}

export async function setQuestionStatusAction(id: string, status: "ACTIVE" | "RETIRED") {
  return runAction(async () => {
    const ctx = await requireAuth();
    await setQuestionStatus(ctx, id, status);
    revalidatePath("/question-bank");
    revalidatePath(`/question-bank/${id}`);
  }, status === "RETIRED" ? "Question retired. Historical papers keep their copy." : "Question is active");
}

export async function similarToAction(courseId: string, text: string, excludeId?: string) {
  return runAction(async () => {
    const ctx = await requireAuth("question.view");
    return findSimilarQuestions(ctx, courseId, text, excludeId);
  });
}

export async function uploadQuestionImageAction(form: FormData) {
  return runAction(async () => {
    const ctx = await requireAuth("question.create");
    assertRate(`upload:${ctx.user.id}`, 20, 60_000);
    const file = form.get("file");
    if (!(file instanceof File)) throw invalid("Choose an image to upload.");
    const asset = await saveFile({ data: Buffer.from(await file.arrayBuffer()), name: file.name, kind: "QUESTION_IMAGE", ownerId: ctx.user.id });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "file.upload", resourceType: "file", resourceId: asset.id, summary: asset.originalName });
    return { id: asset.id, url: signedAssetUrl(asset.id, 3600), name: asset.originalName };
  });
}

export async function assetUrlsAction(ids: string[]) {
  return runAction(async () => {
    await requireAuth("question.view");
    const clean = z.array(z.string().regex(/^[a-z0-9]+$/i)).max(50).parse(ids);
    const found = await db.fileAsset.findMany({ where: { id: { in: clean }, deletedAt: null }, select: { id: true } });
    return Object.fromEntries(found.map((f) => [f.id, signedAssetUrl(f.id, 3600)]));
  });
}

const savedFilterSchema = z.object({ name: z.string().trim().min(1).max(60), query: z.record(z.string(), z.string()) });

export async function saveFilterAction(input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("question.view");
    const v = savedFilterSchema.parse(input);
    const count = await db.savedFilter.count({ where: { userId: ctx.user.id, scope: "question-bank" } });
    if (count >= 20) throw invalid("You can keep up to 20 saved filters.");
    await db.savedFilter.create({ data: { userId: ctx.user.id, scope: "question-bank", name: v.name, query: v.query } });
    revalidatePath("/question-bank");
  }, "Filter saved");
}

export async function deleteFilterAction(id: string) {
  return runAction(async () => {
    const ctx = await requireAuth("question.view");
    await db.savedFilter.deleteMany({ where: { id, userId: ctx.user.id } });
    revalidatePath("/question-bank");
  });
}
