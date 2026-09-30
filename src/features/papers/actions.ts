"use server";

import { revalidatePath } from "next/cache";
import type { PaperAction } from "@/lib/domain/workflow";
import { runAction } from "@/server/action";
import { requireAuth } from "@/server/auth/current";
import {
  addPaperComment, moderatorReplaceItem, paperDuplicates, previewGeneration, resolveComment, savePaperStructure, transitionPaper,
} from "@/server/services/papers";
import { findSimilarQuestions, searchQuestions } from "@/server/services/questions";
import { cancelAssignment, createAssignment, recommendSetter, respondToAssignment, updateAssignment } from "@/server/services/assignments";

const refresh = (paperId?: string) => {
  revalidatePath("/", "layout");
  if (paperId) revalidatePath(`/papers/${paperId}`);
};

export async function savePaperAction(paperId: string, structure: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth();
    return savePaperStructure(ctx, paperId, structure);
  });
}

export async function transitionPaperAction(paperId: string, action: PaperAction, note?: string, checklist?: Record<string, { ok: boolean; note?: string }>) {
  return runAction(async () => {
    const ctx = await requireAuth();
    const res = await transitionPaper(ctx, paperId, action, { note, moderationChecklist: checklist });
    refresh(paperId);
    return res;
  });
}

/** Final approval screen: approve and lock atomically from the user's perspective. */
export async function approveAndLockAction(paperId: string, note?: string) {
  return runAction(async () => {
    const ctx = await requireAuth();
    await transitionPaper(ctx, paperId, "approve", { note });
    const res = await transitionPaper(ctx, paperId, "lock", { note: "Locked on final approval" });
    refresh(paperId);
    return res;
  });
}

export async function searchBankAction(filters: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("question.view");
    return searchQuestions(ctx, filters);
  });
}

export async function generatePreviewAction(paperId: string, opts: { sections?: string[]; seed?: number; allowRecentReuse?: boolean; keep?: Record<string, string[]> }) {
  return runAction(async () => {
    const ctx = await requireAuth("paper.generate");
    return previewGeneration(ctx, paperId, opts);
  });
}

export async function duplicatesAction(paperId: string) {
  return runAction(async () => {
    const ctx = await requireAuth();
    return paperDuplicates(ctx, paperId);
  });
}

export async function similarQuestionsAction(courseId: string, text: string, excludeId?: string) {
  return runAction(async () => {
    const ctx = await requireAuth("question.view");
    return findSimilarQuestions(ctx, courseId, text, excludeId);
  });
}

export async function addCommentAction(paperId: string, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth();
    await addPaperComment(ctx, paperId, input);
    refresh(paperId);
  }, "Comment added");
}

export async function resolveCommentAction(commentId: string, paperId: string) {
  return runAction(async () => {
    const ctx = await requireAuth();
    await resolveComment(ctx, commentId);
    refresh(paperId);
  });
}

export async function replaceItemAction(paperId: string, itemId: string, questionId: string, reason: string) {
  return runAction(async () => {
    const ctx = await requireAuth("moderation.perform");
    await moderatorReplaceItem(ctx, paperId, itemId, questionId, reason);
    refresh(paperId);
  }, "Question replaced");
}

// ── Assignments ──
export async function respondAssignmentAction(id: string, accept: boolean, reason?: string) {
  return runAction(async () => {
    const ctx = await requireAuth("assignment.respond");
    const paper = await respondToAssignment(ctx, id, accept, reason);
    refresh();
    return { paperId: paper?.id ?? null };
  });
}

export async function createAssignmentAction(input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("assignment.manage");
    await createAssignment(ctx, input);
    refresh();
  }, "Setter appointed and notified");
}

export async function updateAssignmentAction(id: string, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("assignment.manage");
    await updateAssignment(ctx, id, input);
    refresh();
  }, "Assignment updated");
}

export async function cancelAssignmentAction(id: string, reason: string) {
  return runAction(async () => {
    const ctx = await requireAuth("assignment.manage");
    await cancelAssignment(ctx, id, reason);
    refresh();
  }, "Assignment withdrawn");
}

export async function recommendSetterAction(examinationId: string, setterId: string, note?: string) {
  return runAction(async () => {
    const ctx = await requireAuth("assignment.recommend");
    await recommendSetter(ctx, examinationId, setterId, note);
    refresh();
  }, "Recommendation sent to the Examination Cell");
}

export async function builderQuestionsAction(paperId: string, ids: string[]) {
  return runAction(async () => {
    const ctx = await requireAuth("question.view");
    const { paperForUser } = await import("@/server/services/papers");
    const { paper } = await paperForUser(ctx, paperId);
    const { db } = await import("@/server/db");
    const exam = await db.examination.findUniqueOrThrow({ where: { id: paper.examinationId }, select: { courseId: true } });
    const { builderQuestions } = await import("@/server/services/questions");
    return builderQuestions(ctx, exam.courseId, ids);
  });
}

export async function openWorkspaceAction(assignmentId: string) {
  return runAction(async () => {
    const ctx = await requireAuth("paper.edit.own");
    const { openWorkspace } = await import("@/server/services/assignments");
    const paper = await openWorkspace(ctx, assignmentId);
    return { paperId: paper.id };
  });
}
