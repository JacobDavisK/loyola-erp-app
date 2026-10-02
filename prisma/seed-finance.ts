/**
 * Finance demo data: chart of accounts, fee heads, active fee structures, this term's invoices for every
 * cohort, counter payments (full, partial, none) with receipts, and a balanced journal entry for each.
 */
import { fromMinor } from "../src/lib/domain/money";
import type { SeedContext } from "./seed-erp";

export async function seedFinance(s: SeedContext, term: { id: string; name: string }, batches: { bca24: string; bca25: string; bca26: string; bcom25: string }, r: () => number) {
  const { db } = s;
  console.log("› finance: fee heads, structures, invoices, payments, ledger");
  const acct: Record<string, string> = {};
  for (const [key, code, name, type] of [
    ["CASH", "1100", "Cash in hand", "ASSET"], ["BANK", "1110", "Bank", "ASSET"], ["GATEWAY", "1120", "Payment gateway clearing", "ASSET"], ["RECEIVABLE", "1200", "Student fees receivable", "ASSET"],
    ["ADVANCE", "2100", "Student advances (unallocated receipts)", "LIABILITY"], ["REFUNDS_PAYABLE", "2200", "Refunds payable", "LIABILITY"], ["FEE_INCOME", "4100", "Fee income", "INCOME"],
    ["TUITION_INCOME", "4110", "Tuition fee income", "INCOME"], ["EXAM_INCOME", "4120", "Examination fee income", "INCOME"], ["CONCESSIONS", "5100", "Fee concessions and scholarships", "EXPENSE"],
  ] as const) acct[key] = (await db.ledgerAccount.create({ data: { code, name, type } })).id;

  const head = async (code: string, name: string, category: "TUITION" | "EXAMINATION" | "REVALUATION" | "FINE" | "MISCELLANEOUS" | "ADMISSION", income?: string) =>
    (await db.feeHead.create({ data: { code, name, category, incomeAccountId: income ?? null } })).id;
  const h = {
    tuition: await head("TUITION", "Tuition fee", "TUITION", acct.TUITION_INCOME),
    lab: await head("LAB", "Laboratory fee", "MISCELLANEOUS"),
    dev: await head("DEV", "Development fee", "ADMISSION"),
    exam: await head("EXAM", "Examination fee", "EXAMINATION", acct.EXAM_INCOME),
    reval: await head("REVAL", "Revaluation / retotalling fee", "REVALUATION", acct.EXAM_INCOME),
    fine: await head("LIBFINE", "Library fine", "FINE"),
  };
  const label: Record<string, string> = { [h.tuition]: "Tuition fee", [h.lab]: "Laboratory fee", [h.dev]: "Development fee" };

  const structure = (code: string, name: string, programId: string, lines: [string, number, number | null, "ODD" | "EVEN" | null][]) =>
    db.feeStructure.create({
      data: { code, version: 1, name, academicYearId: s.academicYears.current, programId, status: "ACTIVE", lines: { create: lines.map(([feeHeadId, amount, semester, termType]) => ({ feeHeadId, amount: amount.toFixed(2), semester, termType, dueDays: 30 })) } },
      include: { lines: true },
    });
  const bcaS = await structure("BCA-FEES", "BCA fees 2026–27", s.prog.BCA, [[h.tuition, 42000, null, null], [h.lab, 6000, null, "ODD"], [h.dev, 10000, 1, null]]);
  const bcomS = await structure("BCOM-FEES", "B.Com fees 2026–27", s.prog.BCOM, [[h.tuition, 30000, null, null], [h.dev, 8000, 1, null]]);

  let inv = 0;
  let rcpt = 0;
  let jv = 0;
  const pad = (n: number) => String(n).padStart(6, "0");
  const journal = async (memo: string, sourceType: string, sourceId: string, lines: { accountId: string; debit?: number; credit?: number; studentId?: string }[], date: Date) => {
    jv++;
    await db.journalEntry.create({
      data: {
        number: `JV/2026/${pad(jv)}`, date, memo, sourceType, sourceId,
        lines: { create: lines.filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0).map((l) => ({ accountId: l.accountId, debit: fromMinor(l.debit ?? 0), credit: fromMinor(l.credit ?? 0), studentId: l.studentId ?? null })) },
      },
    });
  };

  const cohorts: [string, typeof bcaS, number][] = [[batches.bca24, bcaS, 5], [batches.bca25, bcaS, 3], [batches.bca26, bcaS, 1], [batches.bcom25, bcomS, 3]];
  const issue = new Date("2026-07-01T04:30:00Z");
  const due = new Date("2026-07-31T00:00:00Z");
  for (const [batchId, st, sem] of cohorts) {
    const lines = st.lines.filter((l) => (l.semester === null || l.semester === sem) && (l.termType === null || l.termType === "ODD"));
    const subtotal = lines.reduce((a, l) => a + Math.round(Number(l.amount) * 100), 0);
    const tuition = lines.filter((l) => l.feeHeadId === h.tuition).reduce((a, l) => a + Math.round(Number(l.amount) * 100), 0);
    const students = await db.student.findMany({ where: { batchId }, select: { id: true } });
    for (const stu of students) {
      inv++;
      const number = `INV/2026/${pad(inv)}`;
      const x = r();
      const paid = x < 0.62 ? subtotal : x < 0.8 ? Math.round(subtotal * 0.5) : 0;
      const created = await db.invoice.create({
        data: {
          number, studentId: stu.id, termId: term.id, structureId: st.id, issueDate: issue, dueDate: due, currency: "INR", subtotal: fromMinor(subtotal), total: fromMinor(subtotal),
          amountPaid: fromMinor(paid), status: paid === 0 ? "ISSUED" : paid === subtotal ? "PAID" : "PARTIALLY_PAID", createdById: s.users.finance.id,
          lines: { create: lines.map((l) => ({ feeHeadId: l.feeHeadId, description: `${label[l.feeHeadId]} — ${term.name}`, amount: l.amount })) },
        },
      });
      await journal(`Invoice ${number}`, "invoice", created.id, [
        { accountId: acct.RECEIVABLE, debit: subtotal, studentId: stu.id },
        { accountId: acct.TUITION_INCOME, credit: tuition },
        { accountId: acct.FEE_INCOME, credit: subtotal - tuition },
      ], issue);
      if (paid === 0) continue;
      rcpt++;
      const receiptNo = `RCPT/2026/${pad(rcpt)}`;
      const y = r();
      const method = y < 0.5 ? "BANK_TRANSFER" : y < 0.8 ? "CASH" : "CHEQUE";
      const when = new Date(issue.getTime() + Math.floor(r() * 40) * 86_400_000);
      const p = await db.payment.create({
        data: {
          receiptNo, studentId: stu.id, amount: fromMinor(paid), currency: "INR", method, status: "SUCCEEDED", reference: method === "CASH" ? null : `REF${100000 + rcpt}`,
          idempotencyKey: `seed-${rcpt}`, receivedById: s.users.accounts.id, receivedAt: when, confirmedAt: when, allocations: { create: [{ invoiceId: created.id, amount: fromMinor(paid) }] },
        },
      });
      await journal(`Receipt ${receiptNo}`, "payment", p.id, [
        { accountId: method === "CASH" ? acct.CASH : acct.BANK, debit: paid },
        { accountId: acct.RECEIVABLE, credit: paid, studentId: stu.id },
      ], when);
    }
  }
  await db.numberSequence.createMany({
    data: [
      { key: "invoice", prefix: "INV/{YYYY}/", next: inv + 1, padding: 6 },
      { key: "receipt", prefix: "RCPT/{YYYY}/", next: rcpt + 1, padding: 6 },
      { key: "journal", prefix: "JV/{YYYY}/", next: jv + 1, padding: 6 },
    ],
  });
  await db.scholarshipScheme.create({
    data: {
      code: "MERIT-2026", name: "Merit scholarship 2026–27", sponsor: "University of the World Endowment", description: "For students with a strong academic record and no outstanding failures.",
      percent: 25, seats: 20, status: "OPEN", opensAt: new Date("2026-08-01"), closesAt: new Date("2026-12-31"), criteria: { minCgpa: 6.5, minAttendancePercent: 75, noFailures: true },
    },
  });
  await db.scholarshipScheme.create({
    data: { code: "NEED-2026", name: "Need-based fee support", sponsor: "Alumni Association", amount: "15000.00", seats: 30, status: "OPEN", closesAt: new Date("2026-11-30"), criteria: { maxFamilyIncome: 300000, minAttendancePercent: 65 } },
  });
}
