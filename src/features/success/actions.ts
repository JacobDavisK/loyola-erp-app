"use server";

import { revalidatePath } from "next/cache";
import { zonedTimeToUtc } from "@/lib/domain/timetable";
import { runAction } from "@/server/action";
import { getInstitution } from "@/server/services/directory";
import { requireAuth } from "@/server/auth/current";
import { askAssistant } from "@/server/services/assistant";
import { deleteArticle, saveArticle } from "@/server/services/knowledge";
import { assignMentor, endMentorship, recordMeeting, toggleActionItem } from "@/server/services/mentoring";
import { autoPlan, setPlanEntry } from "@/server/services/planner";
import { setItemOutcomes } from "@/server/services/recommendations";
import { addCaseNote, assignCase, computeRisks, openCase, setCaseStatus } from "@/server/services/success";

const refresh = (...paths: string[]) => {
  for (const p of paths) revalidatePath(p, "layout");
};

// Early warning and support cases
export async function recomputeRisksAction() {
  return runAction(async () => { await requireAuth("success.manage"); const r = await computeRisks(); refresh("/success"); return r; }, "Risk recomputed for the current term");
}
export async function openCaseAction(studentId: string, _id: string | null, input: unknown) {
  return runAction(async () => { const c = await openCase(await requireAuth(), studentId, input); refresh("/success", "/students", "/portal", "/mentoring"); return { id: c.id }; }, "Support case opened");
}
export async function addCaseNoteAction(id: string, input: unknown) {
  return runAction(async () => { await addCaseNote(await requireAuth(), id, input); refresh("/success", "/portal"); }, "Note added");
}
export async function assignCaseAction(id: string, userId: string) {
  return runAction(async () => { await assignCase(await requireAuth("success.manage"), id, userId); refresh("/success"); }, "Case assigned");
}
export async function setCaseStatusAction(id: string, input: unknown) {
  return runAction(async () => { await setCaseStatus(await requireAuth(), id, input); refresh("/success", "/portal"); }, "Case updated");
}

// Mentoring
export async function assignMentorAction(input: unknown) {
  return runAction(async () => { await assignMentor(await requireAuth("mentoring.manage"), input); refresh("/mentoring", "/students"); }, "Mentor assigned");
}
export async function endMentorshipAction(id: string) {
  return runAction(async () => { await endMentorship(await requireAuth("mentoring.manage"), id); refresh("/mentoring", "/students"); }, "Mentorship ended");
}
export async function recordMeetingAction(studentId: string, _id: string | null, input: unknown) {
  return runAction(async () => {
    const v = { ...(input as Record<string, unknown>) };
    // datetime-local values are in the institution's time zone.
    if (typeof v.heldOn === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v.heldOn)) v.heldOn = zonedTimeToUtc(v.heldOn.slice(0, 10), v.heldOn.slice(11, 16), (await getInstitution()).timezone);
    await recordMeeting(await requireAuth(), studentId, v);
    refresh("/mentoring", "/students", "/portal");
  }, "Meeting recorded");
}
export async function toggleActionItemAction(meetingId: string, index: number) {
  return runAction(async () => { await toggleActionItem(await requireAuth(), meetingId, index); refresh("/mentoring", "/portal"); });
}

// Knowledge base and assistant
export async function saveArticleAction(id: string | null, input: unknown) {
  return runAction(async () => { const a = await saveArticle(await requireAuth("knowledge.manage"), id, input); refresh("/knowledge"); return { slug: a.slug }; }, "Article saved");
}
export async function deleteArticleAction(id: string) {
  return runAction(async () => { await deleteArticle(await requireAuth("knowledge.manage"), id); refresh("/knowledge"); }, "Article deleted");
}
export async function askAssistantAction(input: unknown) {
  return runAction(async () => askAssistant(await requireAuth("self.portal"), input));
}

// Degree planner
export async function setPlanEntryAction(studentId: string, input: unknown) {
  return runAction(async () => { await setPlanEntry(await requireAuth(), studentId, input); refresh("/portal/planner", "/students"); });
}
export async function autoPlanAction(studentId: string) {
  return runAction(async () => { const n = await autoPlan(await requireAuth(), studentId); refresh("/portal/planner", "/students"); return n; }, "Remaining mandatory courses added to the plan");
}

// Learning recommendations
export async function setItemOutcomesAction(itemId: string, outcomeIds: string[]) {
  return runAction(async () => { await setItemOutcomes(await requireAuth(), itemId, outcomeIds); refresh("/teaching"); }, "Outcomes saved");
}
