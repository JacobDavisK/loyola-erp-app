"use server";

import { revalidatePath } from "next/cache";
import type { SessionStatus } from "@/generated/prisma/enums";
import { runAction } from "@/server/action";
import { requireAuth } from "@/server/auth/current";
import { addExaminations, createSession, setSessionStatus, updateExamination, updateSession } from "@/server/services/examinations";

export async function createSessionAction(input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("session.manage");
    const s = await createSession(ctx, input);
    revalidatePath("/examinations/sessions");
    return { id: s.id };
  }, "Examination session created");
}

export async function updateSessionAction(id: string, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("session.manage");
    await updateSession(ctx, id, input);
    revalidatePath(`/examinations/sessions/${id}`);
  }, "Session updated");
}

export async function setSessionStatusAction(id: string, status: SessionStatus) {
  return runAction(async () => {
    const ctx = await requireAuth("session.manage");
    await setSessionStatus(ctx, id, status);
    revalidatePath(`/examinations/sessions/${id}`);
    revalidatePath("/examinations/sessions");
  }, "Session status updated");
}

export async function addExaminationsAction(sessionId: string, courseIds: string[]) {
  return runAction(async () => {
    const ctx = await requireAuth("exam.manage");
    const n = await addExaminations(ctx, sessionId, courseIds);
    revalidatePath(`/examinations/sessions/${sessionId}`);
    return n;
  });
}

export async function updateExaminationAction(id: string, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("exam.manage");
    await updateExamination(ctx, id, input);
    revalidatePath(`/examinations/${id}`);
  }, "Examination updated");
}
