import "server-only";
import type { Invoice } from "@/generated/prisma/client";
import { allocate, invoiceStatus, spreadConcession } from "@/lib/domain/invoicing";
import { fromMinor, toMinor, type Minor } from "@/lib/domain/money";
import type { Tx } from "@/server/db";
import { invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { emitEvent } from "@/server/services/events";
import { postJournal, type StdAccount } from "@/server/services/ledger";
import { notify } from "@/server/services/notifications";
import { nextNumber } from "@/server/services/sequence";
import { getSetting } from "@/server/services/settings";

/**
 * Finance primitives that run inside a caller's transaction. No workflow imports, so approval hooks can
 * use them. Every money movement posts a balanced journal entry in the same transaction.
 */

type Actor = { id: string | null; name: string };

// ───────── Hooks: what happens when an invoice raised by another module is fully paid ─────────

type PaidHook = (tx: Tx, invoice: Invoice) => Promise<void>;
const paidHooks = new Map<string, PaidHook>();
export function onInvoicePaid(sourceType: string, hook: PaidHook) {
  paidHooks.set(sourceType, hook);
}

onInvoicePaid("examSession", async (tx, inv) => {
  await tx.examRegistration.updateMany({ where: { studentId: inv.studentId, sessionId: inv.sourceId!, feeStatus: "PENDING" }, data: { feeStatus: "PAID" } });
});
onInvoicePaid("revaluationRequest", async (tx, inv) => {
  await tx.revaluationRequest.updateMany({ where: { id: inv.sourceId!, status: "FEE_PENDING" }, data: { status: "REQUESTED", remarks: `Fee paid (invoice ${inv.number})` } });
});

// ───────── Invoices ─────────

export interface NewInvoice {
  studentId: string;
  termId?: string | null;
  structureId?: string | null;
  dueDate: Date;
  lines: { feeHeadId: string; description: string; amount: Minor }[];
  sourceType?: string | null;
  sourceId?: string | null;
  notes?: string | null;
}

export async function issueInvoice(tx: Tx, inv: NewInvoice, actor: Actor) {
  if (!inv.lines.length) throw invalid("An invoice needs at least one line.");
  if (inv.lines.some((l) => l.amount <= 0)) throw invalid("Invoice lines must be positive amounts.");
  const inst = await tx.institution.findFirstOrThrow({ select: { currency: true } });
  const { invoicePrefix } = await getSetting("finance");
  const number = await nextNumber(tx, "invoice", { prefix: invoicePrefix, padding: 6 });
  const subtotal = inv.lines.reduce((a, l) => a + l.amount, 0);
  const heads = await tx.feeHead.findMany({ where: { id: { in: inv.lines.map((l) => l.feeHeadId) } } });
  if (heads.length !== new Set(inv.lines.map((l) => l.feeHeadId)).size) throw invalid("Unknown fee head.");
  const created = await tx.invoice.create({
    data: {
      number, studentId: inv.studentId, termId: inv.termId ?? null, structureId: inv.structureId ?? null, dueDate: inv.dueDate, currency: inst.currency,
      subtotal: fromMinor(subtotal), total: fromMinor(subtotal), sourceType: inv.sourceType ?? null, sourceId: inv.sourceId ?? null, notes: inv.notes ?? null, createdById: actor.id,
      lines: { create: inv.lines.map((l) => ({ feeHeadId: l.feeHeadId, description: l.description, amount: fromMinor(l.amount) })) },
    },
  });
  // Dr receivable / Cr income (per fee head's income account when set)
  const byAccount = new Map<string, Minor>();
  for (const l of inv.lines) {
    const head = heads.find((h) => h.id === l.feeHeadId)!;
    const key = head.incomeAccountId ?? "FEE_INCOME";
    byAccount.set(key, (byAccount.get(key) ?? 0) + l.amount);
  }
  await postJournal(tx, { memo: `Invoice ${number}`, sourceType: "invoice", sourceId: created.id, postedById: actor.id }, [
    { account: "RECEIVABLE", debit: subtotal, studentId: inv.studentId },
    ...[...byAccount].map(([acc, amt]) => ({ account: acc === "FEE_INCOME" ? ("FEE_INCOME" as StdAccount) : { id: acc }, credit: amt })),
  ]);
  await audit({ actorId: actor.id, actorName: actor.name, action: "invoice.issue", resourceType: "student", resourceId: inv.studentId, summary: `Invoice ${number}: ${fromMinor(subtotal)}`, newValue: { invoiceId: created.id } }, tx);
  const s = await tx.student.findUnique({ where: { id: inv.studentId }, select: { userId: true, guardians: { where: { canViewFinance: true, userId: { not: null } }, select: { userId: true } } } });
  await notify({ userIds: [s?.userId, ...(s?.guardians.map((g) => g.userId) ?? [])], type: "invoice.issued", title: `New fee invoice ${number}`, body: `Due ${inv.dueDate.toDateString()}`, link: "/portal/fees" }, tx);
  return created;
}

/** Recompute an invoice's paid amount and status from its successful payment allocations. */
export async function refreshInvoice(tx: Tx, invoiceId: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const allocs = await tx.paymentAllocation.findMany({ where: { invoiceId, payment: { status: "SUCCEEDED" } } });
  const paid = allocs.reduce((a, x) => a + toMinor(x.amount), 0);
  const total = toMinor(inv.total);
  const status = invoiceStatus(total, paid, !!inv.cancelledAt);
  const updated = await tx.invoice.update({ where: { id: invoiceId }, data: { amountPaid: fromMinor(Math.min(paid, total)), status } });
  if (status === "PAID" && inv.status !== "PAID") {
    if (inv.sourceType && paidHooks.has(inv.sourceType)) await paidHooks.get(inv.sourceType)!(tx, updated);
    await emitEvent(tx, { type: "InvoicePaid", aggregateType: "invoice", aggregateId: invoiceId, payload: { studentId: inv.studentId, sourceType: inv.sourceType, sourceId: inv.sourceId } });
  }
  return updated;
}

export async function openInvoices(tx: Tx, studentId: string) {
  const list = await tx.invoice.findMany({ where: { studentId, status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, orderBy: { dueDate: "asc" } });
  return list.map((i) => ({ id: i.id, dueDate: i.dueDate, balance: toMinor(i.total) - toMinor(i.amountPaid) }));
}

const CASH_ACCOUNT: Record<string, StdAccount> = { CASH: "CASH", CHEQUE: "BANK", DEMAND_DRAFT: "BANK", BANK_TRANSFER: "BANK", CARD_POS: "BANK", ONLINE: "GATEWAY" };

/**
 * Mark a pending payment as succeeded and apply it: allocate to invoices (preferred one first, then oldest),
 * assign the receipt number, post Dr cash/bank/gateway, Cr receivable (and Cr advances for any excess).
 */
export async function confirmPayment(tx: Tx, paymentId: string, actor: Actor, preferInvoiceId?: string, gateway?: { paymentId: string; payload: unknown }) {
  const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (p.status === "SUCCEEDED") return p; // idempotent (webhook + callback may both arrive)
  if (p.status !== "PENDING") throw workflowError(`The payment is ${p.status.toLowerCase()}.`);
  const amount = toMinor(p.amount);
  const { allocations, unallocated } = allocate(amount, await openInvoices(tx, p.studentId), preferInvoiceId);
  const { receiptPrefix } = await getSetting("finance");
  const receiptNo = await nextNumber(tx, "receipt", { prefix: receiptPrefix, padding: 6 });
  const updated = await tx.payment.update({
    where: { id: paymentId },
    data: { status: "SUCCEEDED", receiptNo, confirmedAt: new Date(), ...(gateway ? { gatewayPaymentId: gateway.paymentId, gatewayPayload: JSON.parse(JSON.stringify(gateway.payload)) } : {}) },
  });
  if (allocations.length) await tx.paymentAllocation.createMany({ data: allocations.map((a) => ({ paymentId, invoiceId: a.invoiceId, amount: fromMinor(a.amount) })) });
  for (const a of allocations) await refreshInvoice(tx, a.invoiceId);
  await postJournal(tx, { memo: `Receipt ${receiptNo}`, sourceType: "payment", sourceId: paymentId, postedById: actor.id }, [
    { account: CASH_ACCOUNT[p.method], debit: amount },
    { account: "RECEIVABLE", credit: amount - unallocated, studentId: p.studentId },
    { account: "ADVANCE", credit: unallocated, studentId: p.studentId },
  ]);
  await audit({ actorId: actor.id, actorName: actor.name, action: "payment.confirm", resourceType: "student", resourceId: p.studentId, summary: `Receipt ${receiptNo}: ${p.amount} by ${p.method.toLowerCase().replace("_", " ")}`, newValue: { paymentId, allocations, unallocated } }, tx);
  await emitEvent(tx, { type: "PaymentReceived", aggregateType: "student", aggregateId: p.studentId, payload: { paymentId, amount: fromMinor(amount), receiptNo }, actorId: actor.id });
  const s = await tx.student.findUnique({ where: { id: p.studentId }, select: { userId: true } });
  await notify({ userIds: [s?.userId], type: "payment.received", title: `Payment received: ${receiptNo}`, body: `Amount ${p.amount} ${p.currency}`, link: "/portal/fees" }, tx);
  return updated;
}

/** Apply an approved concession to its invoice (lines, totals, status) and post Dr concessions / Cr receivable. */
export async function applyConcession(tx: Tx, concessionId: string, actor: Actor) {
  const c = await tx.concession.findUniqueOrThrow({ where: { id: concessionId }, include: { invoice: { include: { lines: true } } } });
  if (c.status === "APPROVED") return;
  const inv = c.invoice;
  if (inv.cancelledAt) throw workflowError("The invoice was cancelled.");
  const amount = toMinor(c.amount);
  const due = toMinor(inv.total) - toMinor(inv.amountPaid);
  if (amount > due) throw workflowError(`The concession (${c.amount}) is more than the balance due (${fromMinor(due)}). Reduce it or refund instead.`);
  const lines = inv.lines.filter((l) => !c.feeHeadId || l.feeHeadId === c.feeHeadId).map((l) => ({ id: l.id, amount: toMinor(l.amount), concession: toMinor(l.concession) }));
  let parts: { id: string; concession: number }[];
  try {
    parts = spreadConcession(lines, amount);
  } catch (e) {
    throw workflowError(e instanceof Error ? e.message : "The concession cannot be applied.");
  }
  for (const part of parts) {
    const line = lines.find((l) => l.id === part.id)!;
    await tx.invoiceLine.update({ where: { id: part.id }, data: { concession: fromMinor(line.concession + part.concession) } });
  }
  const concessionTotal = toMinor(inv.concession) + amount;
  await tx.invoice.update({ where: { id: inv.id }, data: { concession: fromMinor(concessionTotal), total: fromMinor(toMinor(inv.subtotal) - concessionTotal) } });
  await tx.concession.update({ where: { id: concessionId }, data: { status: "APPROVED", decidedAt: new Date() } });
  await refreshInvoice(tx, inv.id);
  await postJournal(tx, { memo: `${c.kind.toLowerCase()} on ${inv.number}`, sourceType: "concession", sourceId: concessionId, postedById: actor.id }, [
    { account: "CONCESSIONS", debit: amount },
    { account: "RECEIVABLE", credit: amount, studentId: c.studentId },
  ]);
  await audit({ actorId: actor.id, actorName: actor.name, action: "concession.apply", resourceType: "student", resourceId: c.studentId, summary: `${c.kind} ${c.amount} on ${inv.number} — ${c.reason}` }, tx);
}

export async function studentBalance(tx: Tx, studentId: string) {
  const [open, overdue] = await Promise.all([
    tx.invoice.findMany({ where: { studentId, status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, select: { total: true, amountPaid: true, dueDate: true } }),
    tx.invoice.count({ where: { studentId, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: new Date() } } }),
  ]);
  return { outstanding: open.reduce((a, i) => a + toMinor(i.total) - toMinor(i.amountPaid), 0), overdue };
}

export async function requireInvoice(tx: Tx, id: string) {
  const inv = await tx.invoice.findUnique({ where: { id } });
  if (!inv) throw notFound("Invoice");
  return inv;
}
