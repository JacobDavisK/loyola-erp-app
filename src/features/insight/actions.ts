"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { draftAnnouncement, draftFeedback, reportFromQuestion } from "@/server/ai/features";
import { requireAuth } from "@/server/auth/current";
import { runReport } from "@/server/reports/engine";
import { saveSetting } from "@/server/services/admin";
import { deleteReport, saveReport } from "@/server/services/report-builder";

export async function runReportAction(definition: unknown) {
  return runAction(async () => runReport(await requireAuth(), definition));
}
export async function saveReportAction(id: string | null, input: unknown) {
  return runAction(async () => { const r = await saveReport(await requireAuth(), id, input); revalidatePath("/reports/builder"); return { id: r.id }; }, "Report saved");
}
export async function deleteReportAction(id: string) {
  return runAction(async () => { await deleteReport(await requireAuth(), id); revalidatePath("/reports/builder"); }, "Report deleted");
}
export async function aiReportAction(question: string) {
  return runAction(async () => reportFromQuestion(await requireAuth(), question));
}
export async function aiFeedbackAction(input: unknown) {
  return runAction(async () => ({ text: await draftFeedback(await requireAuth(), input) }));
}
export async function aiAnnouncementAction(input: unknown) {
  return runAction(async () => draftAnnouncement(await requireAuth(), input));
}
export async function saveAiSettingsAction(input: unknown) {
  return runAction(async () => { await saveSetting(await requireAuth("admin.settings.manage"), "ai", input); revalidatePath("/admin/ai"); }, "AI settings saved");
}
