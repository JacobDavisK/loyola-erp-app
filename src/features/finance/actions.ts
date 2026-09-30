"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAuth } from "@/server/auth/current";
import {
  activateStructure, cancelInvoice, createAdhocInvoice, createExamFeeInvoices, generateTermInvoices, markRefundPaid, recordCounterPayment, requestConcession, requestRefund,
  reversePayment, saveFeeHead, saveStructure, startOnlinePayment,
} from "@/server/services/finance";
import { postManualEntry, reverseManualEntry, saveAccount } from "@/server/services/ledger";
import { applyForScholarship, disburseScholarship, eligibilityPreview, saveScheme } from "@/server/services/scholarships";

const fin = () => revalidatePath("/finance", "layout");

export async function saveFeeHeadAction(id: string | null, input: unknown) {
  return runAction(async () => { await saveFeeHead(await requireAuth("fee.manage"), id, input); fin(); }, "Fee head saved");
}
export async function saveStructureAction(id: string | null, input: unknown) {
  return runAction(async () => { const s = await saveStructure(await requireAuth("fee.manage"), id, input); fin(); return { id: s.id }; }, "Fee structure saved");
}
export async function activateStructureAction(id: string) {
  return runAction(async () => { await activateStructure(await requireAuth("fee.manage"), id); fin(); }, "Structure activated");
}
export async function generateTermInvoicesAction(_id: string | null, input: unknown) {
  return runAction(async () => { const r = await generateTermInvoices(await requireAuth("invoice.manage"), input); fin(); return r; }, "Invoices generated");
}
export async function createExamFeeInvoicesAction(sessionId: string) {
  return runAction(async () => { const r = await createExamFeeInvoices(await requireAuth("invoice.manage"), sessionId); fin(); revalidatePath("/exam-ops"); return r; });
}
export async function createAdhocInvoiceAction(_id: string | null, input: unknown) {
  return runAction(async () => { const i = await createAdhocInvoice(await requireAuth("invoice.manage"), input); fin(); return { id: i.id }; }, "Invoice raised");
}
export async function cancelInvoiceAction(id: string, reason: string) {
  return runAction(async () => { await cancelInvoice(await requireAuth("invoice.manage"), id, reason); fin(); }, "Invoice cancelled");
}
export async function recordPaymentAction(_id: string | null, input: unknown) {
  return runAction(async () => {
    const p = await recordCounterPayment(await requireAuth("payment.record"), input);
    fin();
    revalidatePath("/students", "layout");
    return { id: p.id, receiptNo: p.receiptNo };
  }, "Payment recorded");
}
export async function reversePaymentAction(id: string, reason: string) {
  return runAction(async () => { await reversePayment(await requireAuth("payment.reverse"), id, reason); fin(); }, "Payment reversed");
}
export async function requestRefundAction(paymentId: string, input: unknown) {
  return runAction(async () => { await requestRefund(await requireAuth("payment.reverse"), paymentId, input); fin(); }, "Refund sent for approval");
}
export async function markRefundPaidAction(refundId: string, reference: string) {
  return runAction(async () => { await markRefundPaid(await requireAuth("payment.reverse"), refundId, reference); fin(); }, "Refund marked paid");
}
export async function requestConcessionAction(invoiceId: string, input: unknown) {
  return runAction(async () => { await requestConcession(await requireAuth("concession.request"), invoiceId, input); fin(); }, "Concession sent for approval");
}
export async function startOnlinePaymentAction(invoiceId: string) {
  return runAction(async () => startOnlinePayment(await requireAuth("self.portal"), invoiceId));
}
export async function saveSchemeAction(id: string | null, input: unknown) {
  return runAction(async () => { await saveScheme(await requireAuth("scholarship.manage"), id, input); fin(); }, "Scholarship saved");
}
export async function applyScholarshipAction(_id: string | null, input: unknown) {
  return runAction(async () => { await applyForScholarship(await requireAuth("scholarship.apply"), input); revalidatePath("/portal/fees"); }, "Application submitted");
}
export async function eligibilityPreviewAction(schemeId: string, income: number | null) {
  return runAction(async () => eligibilityPreview(await requireAuth("scholarship.apply"), schemeId, income));
}
export async function disburseScholarshipAction(applicationId: string) {
  return runAction(async () => { const r = await disburseScholarship(await requireAuth("scholarship.manage"), applicationId); fin(); return r; }, "Award credited");
}
export async function saveAccountAction(id: string | null, input: unknown) {
  return runAction(async () => { await saveAccount(await requireAuth("ledger.manage"), id, input); fin(); }, "Account saved");
}
export async function postManualEntryAction(input: unknown) {
  return runAction(async () => { const e = await postManualEntry(await requireAuth("ledger.manage"), input); fin(); return { number: e.number }; }, "Journal entry posted");
}
export async function reverseManualEntryAction(id: string, reason: string) {
  return runAction(async () => { await reverseManualEntry(await requireAuth("ledger.manage"), id, reason); fin(); }, "Entry reversed");
}

/** Flat form fields (from the generic form dialog) → scheme with nested eligibility criteria. */
export async function saveSchemeFormAction(id: string | null, input: Record<string, unknown>) {
  const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  const list = (v: unknown) => (typeof v === "string" ? v.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean) : []);
  return saveSchemeAction(id, {
    code: input.code, name: input.name, sponsor: input.sponsor, description: input.description, status: input.status,
    amount: n(input.amount), percent: n(input.percent), seats: n(input.seats), opensAt: input.opensAt || null, closesAt: input.closesAt || null,
    criteria: {
      minCgpa: n(input.minCgpa), minAttendancePercent: n(input.minAttendancePercent), maxFamilyIncome: n(input.maxFamilyIncome),
      programCodes: list(input.programCodes), categories: list(input.categories), noFailures: !!input.noFailures,
    },
  });
}

export async function applyScholarshipFormAction(schemeId: string, _id: string | null, input: Record<string, unknown>) {
  return applyScholarshipAction(null, { ...input, schemeId, declaredIncome: input.declaredIncome === null || input.declaredIncome === "" ? null : Number(input.declaredIncome) });
}
