import { describe, expect, it } from "vitest";
import { toMinor } from "@/lib/domain/money";
import { db } from "@/server/db";
import {
  cancelInvoice, createAdhocInvoice, generateTermInvoices, invoiceWhere, markRefundPaid, recordCounterPayment, requestConcession, requestRefund, reversePayment,
} from "@/server/services/finance";
import { trialBalance } from "@/server/services/ledger";
import { applyForScholarship, disburseScholarship } from "@/server/services/scholarships";
import { decideTask } from "@/server/services/workflow";
import { as } from "./helpers";

const unpaidInvoice = async () => db.invoice.findFirstOrThrow({ where: { status: "ISSUED", student: { batch: { code: "BCA-2025" } } }, include: { student: true } });
const approveAll = async (instanceId: string) => {
  for (let i = 0; i < 5; i++) {
    const t = await db.workflowTask.findFirst({ where: { instanceId, status: "PENDING" }, include: { assignee: true } });
    if (!t) return;
    await decideTask(await as(t.assignee.email.replace("@example.edu", "")), t.id, { decision: "approve" });
  }
};
const ledgerBalanced = async () => {
  const tb = await trialBalance();
  expect(tb.reduce((a, x) => a + x.debit, 0)).toBe(tb.reduce((a, x) => a + x.credit, 0));
};

describe("payments", () => {
  it("records a counter payment once per idempotency key, allocates it and posts the ledger", async () => {
    const acc = await as("accounts");
    const inv = await unpaidInvoice();
    const key = "test-key-0001";
    const total = toMinor(inv.total);
    const p1 = await recordCounterPayment(acc, { studentId: inv.studentId, amount: total / 100, method: "CASH", invoiceId: inv.id, idempotencyKey: key });
    const p2 = await recordCounterPayment(acc, { studentId: inv.studentId, amount: total / 100, method: "CASH", invoiceId: inv.id, idempotencyKey: key });
    expect(p2.id).toBe(p1.id);
    expect(p1.receiptNo).toMatch(/^RCPT\/\d{4}\/\d{6}$/);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PAID");
    expect(await db.payment.count({ where: { idempotencyKey: key } })).toBe(1);
    await expect(recordCounterPayment(acc, { studentId: inv.studentId, amount: 1, method: "CHEQUE", idempotencyKey: "test-key-0002" })).rejects.toThrow(/reference/);
    await ledgerBalanced();
  });

  it("keeps overpayments as credit and refunds only that credit", async () => {
    const acc = await as("accounts");
    const inv = await unpaidInvoice();
    const over = toMinor(inv.total) + 50000;
    const p = await recordCounterPayment(acc, { studentId: inv.studentId, amount: over / 100, method: "BANK_TRANSFER", reference: "UTR123", invoiceId: inv.id, idempotencyKey: "test-key-0003" });
    await expect(requestRefund(acc, p.id, { amount: 600, reason: "Paid more than the invoice amount." })).rejects.toThrow(/At most 500/);
    const inst = await requestRefund(acc, p.id, { amount: 500, reason: "Paid more than the invoice amount." });
    await approveAll(inst.id);
    const refund = await db.refund.findFirstOrThrow({ where: { paymentId: p.id } });
    expect(refund.status).toBe("APPROVED");
    await markRefundPaid(acc, refund.id, "NEFT-99");
    await ledgerBalanced();
  });

  it("reverses a bounced cheque: the invoice reopens and history is kept", async () => {
    const acc = await as("accounts");
    const inv = await unpaidInvoice();
    const p = await recordCounterPayment(acc, { studentId: inv.studentId, amount: toMinor(inv.total) / 100, method: "CHEQUE", reference: "CHQ 445566", invoiceId: inv.id, idempotencyKey: "test-key-0004" });
    await reversePayment(acc, p.id, "Cheque returned unpaid by the bank");
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("ISSUED");
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("REVERSED");
    await expect(db.payment.update({ where: { id: p.id }, data: { amount: "1.00" } })).rejects.toThrow(/cannot be altered/);
    await expect(db.payment.update({ where: { id: p.id }, data: { status: "SUCCEEDED" } })).rejects.toThrow(/Invalid payment status/);
    await expect(db.payment.delete({ where: { id: p.id } })).rejects.toThrow(/cannot be deleted/);
    await ledgerBalanced();
  });
});

describe("invoices, concessions & scholarships", () => {
  it("raises term invoices idempotently from the active structure", async () => {
    const fin = await as("finance");
    const [structure, term, batch] = await Promise.all([
      db.feeStructure.findFirstOrThrow({ where: { code: "BCA-FEES", status: "ACTIVE" } }),
      db.academicTerm.findFirstOrThrow({ where: { code: "2026-27-EVEN" } }),
      db.batch.findUniqueOrThrow({ where: { code: "BCA-2026" } }),
    ]);
    const r1 = await generateTermInvoices(fin, { structureId: structure.id, termId: term.id, batchId: batch.id });
    expect(r1.created).toBeGreaterThan(10);
    const one = await db.invoice.findFirstOrThrow({ where: { termId: term.id, structureId: structure.id }, include: { lines: true } });
    // Even term, semester 1 student: tuition + development (lab is odd-term only).
    expect(one.lines.length).toBe(2);
    expect((await generateTermInvoices(fin, { structureId: structure.id, termId: term.id, batchId: batch.id })).created).toBe(0);
    await cancelInvoice(fin, one.id, "Raised in error for testing");
    await ledgerBalanced();
  });

  it("applies an approved concession across invoice lines and posts it", async () => {
    const hod = await as("hod.cs");
    const inv = await unpaidInvoice();
    await expect(requestConcession(await as("hod.commerce"), inv.id, { amount: 1000, kind: "CONCESSION", reason: "Sibling concession as per policy." })).rejects.toThrow(/permission/i);
    const inst = await requestConcession(hod, inv.id, { amount: 5000, kind: "CONCESSION", reason: "Sibling concession as per policy." });
    await approveAll(inst.id);
    const after = await db.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: { lines: true } });
    expect(toMinor(after.concession)).toBe(500000);
    expect(toMinor(after.total)).toBe(toMinor(inv.total) - 500000);
    expect(after.lines.reduce((a, l) => a + toMinor(l.concession), 0)).toBe(500000);
    await ledgerBalanced();
  });

  it("checks scholarship rules, routes approval and credits the award", async () => {
    const student = await as("student");
    const need = await db.scholarshipScheme.findUniqueOrThrow({ where: { code: "NEED-2026" } });
    await expect(applyForScholarship(student, { schemeId: need.id, statement: "My family income is limited and I would like support with fees this year.", declaredIncome: 900000 })).rejects.toThrow(/family income/);
    const inst = await applyForScholarship(student, { schemeId: need.id, statement: "My family income is limited and I would like support with fees this year.", declaredIncome: 200000 });
    await approveAll(inst.id);
    const app = await db.scholarshipApplication.findFirstOrThrow({ where: { schemeId: need.id, studentId: student.subject.studentId! } });
    expect(app.status).toBe("APPROVED");
    // Give the student an open invoice to credit.
    const fin = await as("finance");
    const head = await db.feeHead.findUniqueOrThrow({ where: { code: "TUITION" } });
    await createAdhocInvoice(fin, { studentId: student.subject.studentId!, feeHeadId: head.id, description: "Tuition balance", amount: 20000, dueDate: new Date(Date.now() + 86_400_000) });
    const res = await disburseScholarship(fin, app.id);
    expect(res.remaining).toBe(0);
    expect((await db.scholarshipApplication.findUniqueOrThrow({ where: { id: app.id } })).status).toBe("DISBURSED");
    await ledgerBalanced();
  });

  it("guardians see fees only when the institution allows it", async () => {
    const parent = await as("parent");
    const w1 = await invoiceWhere(parent);
    expect(await db.invoice.count({ where: w1 })).toBeGreaterThan(0);
    await db.guardian.updateMany({ where: { userId: parent.user.id }, data: { canViewFinance: false } });
    expect(await db.invoice.count({ where: await invoiceWhere(parent) })).toBe(0);
    await db.guardian.updateMany({ where: { userId: parent.user.id }, data: { canViewFinance: true } });
  });

  it("refuses unbalanced journal entries at the database", async () => {
    const [a, b] = await db.ledgerAccount.findMany({ take: 2 });
    await expect(db.$transaction(async (tx) => {
      await tx.journalEntry.create({ data: { number: "JV/TEST/1", date: new Date(), memo: "bad", lines: { create: [{ accountId: a.id, debit: "10.00" }, { accountId: b.id, credit: "9.00" }] } } });
    })).rejects.toThrow(/not balanced/);
  });
});
