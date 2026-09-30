import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { FeeCategory, PaymentMethod } from "@/generated/prisma/enums";
import { applicableLines } from "@/lib/domain/invoicing";
import { fromMinor, toMinor } from "@/lib/domain/money";
import { loadStudentFor, studentWhere } from "@/server/auth/access";
import { type AuthContext, can, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { paymentGateway } from "@/server/payments/gateway";
import { audit } from "@/server/services/audit";
import { confirmPayment, issueInvoice, refreshInvoice, studentBalance } from "@/server/services/finance-core";
import { postJournal, reverseEntriesFor } from "@/server/services/ledger";
import { getSetting } from "@/server/services/settings";
import { startWorkflow } from "@/server/services/workflow";
import type { ConcessionData, RefundData } from "@/server/workflow/modules/finance";

const need = (ctx: AuthContext, perm: "fee.manage" | "invoice.manage" | "payment.record" | "payment.reverse") => {
  if (!can(ctx, perm)) throw forbidden();
};
const money = z.number().positive().max(100_000_000).refine((n) => Math.round(n * 100) === n * 100, "At most two decimals");

// ───────────────────────── Fee heads & structures ─────────────────────────

export const feeHeadSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,16}$/),
  name: z.string().trim().min(2).max(120),
  category: z.enum(FeeCategory),
  isRefundable: z.boolean().default(false),
  isActive: z.boolean().default(true),
  incomeAccountId: z.string().nullable().optional(),
});

export async function saveFeeHead(ctx: AuthContext, id: string | null, raw: unknown) {
  need(ctx, "fee.manage");
  const v = feeHeadSchema.parse(raw);
  const h = id ? await db.feeHead.update({ where: { id }, data: { ...v, incomeAccountId: v.incomeAccountId || null } }) : await db.feeHead.create({ data: { ...v, incomeAccountId: v.incomeAccountId || null } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: id ? "fee.head.update" : "fee.head.create", resourceType: "feeHead", resourceId: h.id, summary: `${v.code} ${v.name}` });
  return h;
}

export const structureSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,24}$/),
  name: z.string().trim().min(3).max(160),
  academicYearId: z.string().min(1),
  programId: z.string().nullable().optional(),
  batchId: z.string().nullable().optional(),
  lines: z.array(z.object({ feeHeadId: z.string().min(1), amount: money, semester: z.number().int().min(1).max(16).nullable().optional(), termType: z.enum(["ODD", "EVEN"]).nullable().optional(), dueDays: z.number().int().min(0).max(365).default(30) })).min(1).max(50),
});

/** Draft structures are edited in place; editing an active one creates the next version as a draft. */
export async function saveStructure(ctx: AuthContext, id: string | null, raw: unknown) {
  need(ctx, "fee.manage");
  const v = structureSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const lines = v.lines.map((l) => ({ feeHeadId: l.feeHeadId, amount: l.amount.toFixed(2), semester: l.semester ?? null, termType: l.termType ?? null, dueDays: l.dueDays }));
    const base = { name: v.name, academicYearId: v.academicYearId, programId: v.programId || null, batchId: v.batchId || null };
    let s;
    if (id) {
      const cur = await tx.feeStructure.findUnique({ where: { id } });
      if (!cur) throw notFound("Fee structure");
      if (cur.status === "DRAFT") {
        await tx.feeStructureLine.deleteMany({ where: { structureId: id } });
        s = await tx.feeStructure.update({ where: { id }, data: { ...base, lines: { create: lines } } });
      } else {
        const latest = await tx.feeStructure.findFirst({ where: { code: cur.code }, orderBy: { version: "desc" } });
        s = await tx.feeStructure.create({ data: { ...base, code: cur.code, version: (latest?.version ?? 0) + 1, lines: { create: lines } } });
      }
    } else {
      if (await tx.feeStructure.findFirst({ where: { code: v.code } })) throw conflict("A structure with this code exists; edit it to create a new version.");
      s = await tx.feeStructure.create({ data: { ...base, code: v.code, version: 1, lines: { create: lines } } });
    }
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "fee.structure.save", resourceType: "feeStructure", resourceId: s.id, summary: `${s.code} v${s.version}: ${lines.length} line(s)` }, tx);
    return s;
  });
}

export async function activateStructure(ctx: AuthContext, id: string) {
  need(ctx, "fee.manage");
  const s = await db.feeStructure.findUnique({ where: { id } });
  if (!s) throw notFound("Fee structure");
  await db.$transaction(async (tx) => {
    await tx.feeStructure.updateMany({ where: { code: s.code, status: "ACTIVE", id: { not: id } }, data: { status: "RETIRED" } });
    await tx.feeStructure.update({ where: { id }, data: { status: "ACTIVE" } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "fee.structure.activate", resourceType: "feeStructure", resourceId: id, summary: `${s.code} v${s.version}` }, tx);
  });
}

// ───────────────────────── Invoices ─────────────────────────

/**
 * Raise term invoices from the active structure for every active student of a batch (optionally a section).
 * Students who already have an invoice from this structure for the term are skipped, so it is safe to re-run.
 */
export async function generateTermInvoices(ctx: AuthContext, raw: unknown) {
  need(ctx, "invoice.manage");
  const v = z.object({ structureId: z.string().min(1), termId: z.string().min(1), batchId: z.string().min(1), section: z.string().nullable().optional() }).parse(raw);
  const [structure, term] = await Promise.all([
    db.feeStructure.findUnique({ where: { id: v.structureId }, include: { lines: { include: { feeHead: true } } } }),
    db.academicTerm.findUnique({ where: { id: v.termId } }),
  ]);
  if (!structure || structure.status !== "ACTIVE") throw invalid("Choose an active fee structure.");
  if (!term) throw notFound("Term");
  const students = await db.student.findMany({ where: { AND: [studentWhere(ctx), { batchId: v.batchId, status: "ACTIVE", ...(v.section ? { section: v.section } : {}) }] }, select: { id: true, currentSemester: true } });
  const existing = new Set((await db.invoice.findMany({ where: { structureId: v.structureId, termId: v.termId, cancelledAt: null, studentId: { in: students.map((s) => s.id) } }, select: { studentId: true } })).map((i) => i.studentId));
  let created = 0;
  let skipped = 0;
  const actor = { id: ctx.user.id, name: ctx.user.name };
  for (const s of students) {
    if (existing.has(s.id)) { skipped++; continue; }
    const lines = applicableLines(structure.lines.map((l) => ({ feeHeadId: l.feeHeadId, feeHeadName: l.feeHead.name, amount: toMinor(l.amount), semester: l.semester, termType: l.termType, dueDays: l.dueDays })), s.currentSemester, term.termType);
    if (!lines.length) { skipped++; continue; }
    const due = new Date(Date.now() + Math.min(...lines.map((l) => l.dueDays)) * 86_400_000);
    await db.$transaction((tx) => issueInvoice(tx, { studentId: s.id, termId: term.id, structureId: structure.id, dueDate: due, lines: lines.map((l) => ({ feeHeadId: l.feeHeadId, description: `${l.feeHeadName} — ${term.name}`, amount: l.amount })) }, actor));
    created++;
  }
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "invoice.generate", resourceType: "feeStructure", resourceId: structure.id, summary: `${term.name}: ${created} invoice(s) raised, ${skipped} skipped` });
  return { created, skipped };
}

export async function createAdhocInvoice(ctx: AuthContext, raw: unknown) {
  need(ctx, "invoice.manage");
  const v = z.object({ studentId: z.string().min(1), feeHeadId: z.string().min(1), description: z.string().trim().min(3).max(200), amount: money, dueDate: z.coerce.date() }).parse(raw);
  await loadStudentFor(ctx, v.studentId);
  return db.$transaction((tx) => issueInvoice(tx, { studentId: v.studentId, dueDate: v.dueDate, lines: [{ feeHeadId: v.feeHeadId, description: v.description, amount: toMinor(v.amount) }] }, { id: ctx.user.id, name: ctx.user.name }));
}

/** Examination fee invoices for confirmed-or-eligible candidates of a session (one invoice per student). */
export async function createExamFeeInvoices(ctx: AuthContext, sessionId: string) {
  need(ctx, "invoice.manage");
  const { examFeePerPaper } = await getSetting("finance");
  if (examFeePerPaper <= 0) throw invalid("Set the examination fee per paper in the finance settings first.");
  const head = await db.feeHead.findFirst({ where: { category: "EXAMINATION", isActive: true } });
  if (!head) throw invalid("Create an active fee head of category Examination first.");
  const session = await db.examinationSession.findUniqueOrThrow({ where: { id: sessionId } });
  const regs = await db.examRegistration.findMany({ where: { sessionId, feeStatus: "PENDING", status: { in: ["ELIGIBLE", "CONDONATION_PENDING"] } }, include: { examination: { include: { course: { select: { code: true } } } } } });
  const byStudent = new Map<string, typeof regs>();
  for (const r of regs) (byStudent.get(r.studentId) ?? byStudent.set(r.studentId, []).get(r.studentId)!).push(r);
  let created = 0;
  for (const [studentId, list] of byStudent) {
    if (await db.invoice.findFirst({ where: { studentId, sourceType: "examSession", sourceId: sessionId, cancelledAt: null } })) continue;
    await db.$transaction((tx) => issueInvoice(tx, {
      studentId, dueDate: new Date(Date.now() + 14 * 86_400_000), sourceType: "examSession", sourceId: sessionId,
      lines: list.map((r) => ({ feeHeadId: head.id, description: `Examination fee — ${r.examination.course.code}, ${session.code}`, amount: Math.round(examFeePerPaper * 100) })),
    }, { id: ctx.user.id, name: ctx.user.name }));
    created++;
  }
  return { created };
}

export async function cancelInvoice(ctx: AuthContext, invoiceId: string, reason: string) {
  need(ctx, "invoice.manage");
  if (String(reason ?? "").trim().length < 5) throw invalid("Give the reason for cancelling.");
  const inv = await db.invoice.findUnique({ where: { id: invoiceId }, include: { allocations: { where: { payment: { status: "SUCCEEDED" } } } } });
  if (!inv) throw notFound("Invoice");
  if (inv.cancelledAt) throw conflict("Already cancelled.");
  if (inv.allocations.length) throw workflowError("Payments have been applied to this invoice. Reverse or refund them first.");
  await db.$transaction(async (tx) => {
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason } });
    await reverseEntriesFor(tx, "invoice", invoiceId, `Invoice ${inv.number} cancelled`, ctx.user.id);
    for (const c of await tx.concession.findMany({ where: { invoiceId, status: "APPROVED" }, select: { id: true } })) await reverseEntriesFor(tx, "concession", c.id, `Invoice ${inv.number} cancelled`, ctx.user.id);
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "invoice.cancel", resourceType: "student", resourceId: inv.studentId, summary: `${inv.number} cancelled — ${reason}` }, tx);
  });
}

// ───────────────────────── Payments ─────────────────────────

const counterSchema = z.object({
  studentId: z.string().min(1),
  amount: money,
  method: z.enum(PaymentMethod).refine((m) => m !== "ONLINE", "Online payments are recorded by the gateway"),
  reference: z.string().trim().max(80).nullable().optional(),
  invoiceId: z.string().nullable().optional(),
  idempotencyKey: z.string().min(8).max(80),
});

/**
 * Record a counter payment. The idempotency key (generated when the form opens) makes a double
 * click or a retried request return the same receipt instead of charging twice.
 */
export async function recordCounterPayment(ctx: AuthContext, raw: unknown) {
  need(ctx, "payment.record");
  const v = counterSchema.parse(raw);
  const existing = await db.payment.findUnique({ where: { idempotencyKey: v.idempotencyKey } });
  if (existing) {
    if (existing.studentId !== v.studentId || toMinor(existing.amount) !== toMinor(v.amount)) throw conflict("This form was already used for a different payment. Reload and try again.");
    return existing;
  }
  if (["CHEQUE", "DEMAND_DRAFT", "BANK_TRANSFER", "CARD_POS"].includes(v.method) && !v.reference) throw invalid("Enter the cheque, DD, transfer or card slip reference.");
  await loadStudentFor(ctx, v.studentId);
  const inst = await db.institution.findFirstOrThrow({ select: { currency: true } });
  return db.$transaction(async (tx) => {
    const p = await tx.payment.create({
      data: { studentId: v.studentId, amount: fromMinor(toMinor(v.amount)), currency: inst.currency, method: v.method, status: "PENDING", reference: v.reference ?? null, idempotencyKey: v.idempotencyKey, receivedById: ctx.user.id },
    });
    return confirmPayment(tx, p.id, { id: ctx.user.id, name: ctx.user.name }, v.invoiceId ?? undefined);
  });
}

/** Reverse a successful payment (bounced cheque, entry error). Allocations stop counting; the journal is reversed. */
export async function reversePayment(ctx: AuthContext, paymentId: string, reason: string) {
  need(ctx, "payment.reverse");
  if (String(reason ?? "").trim().length < 5) throw invalid("Give the reason for the reversal.");
  const p = await db.payment.findUnique({ where: { id: paymentId }, include: { allocations: true, refunds: { where: { status: { in: ["APPROVED", "PAID"] } } } } });
  if (!p) throw notFound("Payment");
  if (p.status !== "SUCCEEDED") throw workflowError("Only successful payments can be reversed.");
  if (p.refunds.length) throw workflowError("A refund has been approved against this payment.");
  await db.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: paymentId }, data: { status: "REVERSED", reversedAt: new Date(), reversalReason: reason } });
    for (const a of p.allocations) await refreshInvoice(tx, a.invoiceId);
    await reverseEntriesFor(tx, "payment", paymentId, `Receipt ${p.receiptNo} reversed`, ctx.user.id);
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "payment.reverse", resourceType: "student", resourceId: p.studentId, summary: `${p.receiptNo} reversed — ${reason}` }, tx);
  });
}

// ───────────────────────── Online payments ─────────────────────────

/** Create a gateway order for an invoice balance. The client opens the provider's checkout with the result. */
export async function startOnlinePayment(ctx: AuthContext, invoiceId: string) {
  const gw = paymentGateway();
  if (!gw) throw workflowError("Online payment is not available. Please pay at the accounts counter.");
  const inv = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) throw notFound("Invoice");
  const self = ctx.subject.studentId === inv.studentId || ctx.subject.wardStudentIds.includes(inv.studentId);
  if (!self) throw notFound("Invoice");
  const balance = toMinor(inv.total) - toMinor(inv.amountPaid);
  if (balance <= 0 || inv.cancelledAt) throw workflowError("Nothing is due on this invoice.");
  const order = await gw.createOrder({ amountMinor: balance, currency: inv.currency, receipt: inv.number, notes: { invoice: inv.number, student: inv.studentId } });
  if (order.amountMinor !== balance) throw workflowError("The gateway returned a different amount; the payment was not started.");
  await db.payment.create({
    data: { studentId: inv.studentId, amount: fromMinor(balance), currency: inv.currency, method: "ONLINE", status: "PENDING", idempotencyKey: `gw:${order.orderId}`, gatewayProvider: gw.name, gatewayOrderId: order.orderId, gatewayPayload: { invoiceId } },
  });
  return { provider: gw.name, checkout: order.checkout };
}

/**
 * Settle a gateway payment. Called from the checkout callback and from webhooks; both paths verify with
 * the gateway API and are idempotent, so whichever arrives first wins and the other is a no-op.
 */
export async function settleGatewayPayment(input: { orderId: string; paymentId: string; signature?: string }) {
  const gw = paymentGateway();
  if (!gw) throw workflowError("Online payment is not configured.");
  if (input.signature !== undefined && !gw.verifyCheckoutSignature(input.orderId, input.paymentId, input.signature)) throw forbidden("The payment signature is invalid.");
  const pending = await db.payment.findUnique({ where: { gatewayOrderId: input.orderId } });
  if (!pending) throw notFound("Payment order");
  if (pending.status === "SUCCEEDED") return pending;
  const remote = await gw.fetchPayment(input.paymentId);
  if (remote.orderId !== input.orderId) throw forbidden("The payment does not belong to this order.");
  if (remote.status === "failed") {
    return db.payment.update({ where: { id: pending.id }, data: { status: "FAILED", gatewayPaymentId: remote.paymentId, gatewayPayload: JSON.parse(JSON.stringify(remote.raw)) } });
  }
  if (remote.status !== "captured") throw workflowError("The payment has not been captured yet. It will be confirmed automatically.");
  if (remote.amountMinor !== toMinor(pending.amount) || remote.currency !== pending.currency) throw workflowError("The captured amount does not match the order. Accounts will reconcile it.");
  const invoiceId = (pending.gatewayPayload as { invoiceId?: string } | null)?.invoiceId;
  return db.$transaction((tx) => confirmPayment(tx, pending.id, { id: null, name: `Gateway (${gw.name})` }, invoiceId, { paymentId: remote.paymentId, payload: remote.raw }));
}

// ───────────────────────── Concessions & refunds ─────────────────────────

export async function requestConcession(ctx: AuthContext, invoiceId: string, raw: unknown) {
  const v = z.object({ amount: money, kind: z.enum(["WAIVER", "CONCESSION"]), feeHeadId: z.string().nullable().optional(), reason: z.string().trim().min(10).max(500) }).parse(raw);
  const inv = await db.invoice.findUnique({ where: { id: invoiceId }, include: { student: true } });
  if (!inv) throw notFound("Invoice");
  if (!can(ctx, "concession.request", inv.student.departmentId)) throw forbidden();
  if (inv.cancelledAt || inv.status === "PAID") throw workflowError("The invoice is not open.");
  const due = toMinor(inv.total) - toMinor(inv.amountPaid);
  if (toMinor(v.amount) > due) throw invalid(`The balance due is ${fromMinor(due)}.`);
  return db.$transaction(async (tx) => {
    const c = await tx.concession.create({ data: { studentId: inv.studentId, invoiceId, feeHeadId: v.feeHeadId || null, amount: v.amount.toFixed(2), kind: v.kind, reason: v.reason, requestedById: ctx.user.id } });
    const data: ConcessionData = { concessionId: c.id, studentId: inv.studentId, studentNo: inv.student.studentNo, studentName: `${inv.student.firstName} ${inv.student.lastName}`, invoiceNo: inv.number, amount: v.amount, kind: v.kind, reason: v.reason };
    return startWorkflow(tx, { id: ctx.user.id, name: ctx.user.name }, {
      key: "finance.concession", resourceType: "concession", resourceId: c.id, title: `${v.kind === "WAIVER" ? "Waiver" : "Concession"} ${v.amount.toFixed(2)} for ${data.studentName}`,
      summary: v.reason, departmentId: inv.student.departmentId, subjectUserId: inv.student.userId, data: data as unknown as Record<string, unknown>,
    });
  });
}

export async function requestRefund(ctx: AuthContext, paymentId: string, raw: unknown) {
  need(ctx, "payment.reverse");
  const v = z.object({ amount: money, reason: z.string().trim().min(10).max(500) }).parse(raw);
  const p = await db.payment.findUnique({ where: { id: paymentId }, include: { student: true, allocations: true, refunds: { where: { status: { in: ["REQUESTED", "APPROVED", "PAID"] } } } } });
  if (!p || p.status !== "SUCCEEDED") throw notFound("Payment");
  // Only credit that was not applied to any invoice (an overpayment / advance) is refundable.
  const unallocated = toMinor(p.amount) - p.allocations.reduce((a, x) => a + toMinor(x.amount), 0);
  const already = p.refunds.reduce((a, r) => a + toMinor(r.amount), 0);
  if (toMinor(v.amount) + already > unallocated) throw invalid(unallocated - already > 0 ? `At most ${fromMinor(unallocated - already)} (the unapplied credit) can be refunded.` : "This payment was fully applied to invoices. Reverse it and record the retained amount again, then refund the credit.");
  return db.$transaction(async (tx) => {
    const r = await tx.refund.create({ data: { paymentId, amount: v.amount.toFixed(2), reason: v.reason, requestedById: ctx.user.id } });
    const data: RefundData = { refundId: r.id, paymentId, receiptNo: p.receiptNo ?? "", studentId: p.studentId, studentName: `${p.student.firstName} ${p.student.lastName}`, amount: v.amount, reason: v.reason };
    return startWorkflow(tx, { id: ctx.user.id, name: ctx.user.name }, {
      key: "finance.refund", resourceType: "refund", resourceId: r.id, title: `Refund ${v.amount.toFixed(2)} on ${p.receiptNo}`, summary: v.reason,
      departmentId: p.student.departmentId, subjectUserId: p.student.userId, data: data as unknown as Record<string, unknown>,
    });
  });
}

/** Record that an approved refund was paid out, from the student's unapplied credit. */
export async function markRefundPaid(ctx: AuthContext, refundId: string, reference: string) {
  need(ctx, "payment.reverse");
  if (String(reference ?? "").trim().length < 3) throw invalid("Enter the payout reference.");
  const r = await db.refund.findUnique({ where: { id: refundId }, include: { payment: true } });
  if (!r) throw notFound("Refund");
  if (r.status !== "APPROVED") throw workflowError("Only approved refunds can be paid.");
  await db.$transaction(async (tx) => {
    await tx.refund.update({ where: { id: refundId }, data: { status: "PAID", paidAt: new Date(), reference } });
    const amt = toMinor(r.amount);
    await postJournal(tx, { memo: `Refund on ${r.payment.receiptNo}`, sourceType: "refund", sourceId: refundId, postedById: ctx.user.id }, [
      { account: "ADVANCE", debit: amt, studentId: r.payment.studentId },
      { account: "BANK", credit: amt },
    ]);
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "refund.pay", resourceType: "student", resourceId: r.payment.studentId, summary: `Refund ${r.amount} paid (${reference})` }, tx);
  });
}

// ───────────────────────── Queries ─────────────────────────

/** Invoices visible to the caller: finance scope, or self/ward (guardians only with finance visibility). */
export async function invoiceWhere(ctx: AuthContext): Promise<Prisma.InvoiceWhereInput> {
  const scope = scopeOf(ctx, "finance.view");
  if (scope === null) return {};
  const or: Prisma.InvoiceWhereInput[] = [];
  if (scope.length) or.push({ student: { departmentId: { in: scope } } });
  if (ctx.subject.studentId) or.push({ studentId: ctx.subject.studentId });
  if (ctx.subject.wardStudentIds.length) {
    const allowed = await db.guardian.findMany({ where: { userId: ctx.user.id, canViewFinance: true, studentId: { in: ctx.subject.wardStudentIds } }, select: { studentId: true } });
    if (allowed.length) or.push({ studentId: { in: allowed.map((a) => a.studentId) } });
  }
  return { OR: or.length ? or : [{ id: "__none__" }] };
}

export async function balanceFor(ctx: AuthContext, studentId: string) {
  const where = await invoiceWhere(ctx);
  if (!(await db.invoice.count({ where: { AND: [where, { studentId }] } })) && !can(ctx, "finance.view")) throw notFound("Student");
  return db.$transaction((tx) => studentBalance(tx, studentId));
}

export const newIdempotencyKey = () => randomUUID();
