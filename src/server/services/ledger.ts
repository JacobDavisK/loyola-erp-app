import "server-only";
import { z } from "zod";
import { fromMinor, type Minor } from "@/lib/domain/money";
import { type AuthContext, can } from "@/server/auth/current";
import { db, type Tx } from "@/server/db";
import { forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { nextNumber } from "@/server/services/sequence";

/**
 * Double-entry general ledger. Fee operations post automatically; accountants can post manual entries.
 * Entries are append-only (DB trigger) and must balance (deferred constraint trigger); corrections are
 * reversing entries. The standard accounts below are created on first use so a fresh install works.
 */
export const STANDARD_ACCOUNTS = {
  CASH: { code: "1100", name: "Cash in hand", type: "ASSET" },
  BANK: { code: "1110", name: "Bank", type: "ASSET" },
  GATEWAY: { code: "1120", name: "Payment gateway clearing", type: "ASSET" },
  RECEIVABLE: { code: "1200", name: "Student fees receivable", type: "ASSET" },
  ADVANCE: { code: "2100", name: "Student advances (unallocated receipts)", type: "LIABILITY" },
  REFUNDS_PAYABLE: { code: "2200", name: "Refunds payable", type: "LIABILITY" },
  FEE_INCOME: { code: "4100", name: "Fee income", type: "INCOME" },
  CONCESSIONS: { code: "5100", name: "Fee concessions and scholarships", type: "EXPENSE" },
  SALARY_PAYABLE: { code: "2300", name: "Salaries payable", type: "LIABILITY" },
  STATUTORY_PAYABLE: { code: "2310", name: "Statutory deductions payable", type: "LIABILITY" },
  TAX_PAYABLE: { code: "2320", name: "Tax deducted at source payable", type: "LIABILITY" },
  SALARY_EXPENSE: { code: "5200", name: "Salaries and wages", type: "EXPENSE" },
  EMPLOYER_CONTRIBUTIONS: { code: "5210", name: "Employer statutory contributions", type: "EXPENSE" },
} as const;
export type StdAccount = keyof typeof STANDARD_ACCOUNTS;

async function accountId(tx: Tx, key: StdAccount): Promise<string> {
  const a = STANDARD_ACCOUNTS[key];
  const found = await tx.ledgerAccount.findUnique({ where: { code: a.code } });
  if (found) return found.id;
  return (await tx.ledgerAccount.create({ data: { code: a.code, name: a.name, type: a.type } })).id;
}

export interface PostingLine {
  account: StdAccount | { id: string };
  debit?: Minor;
  credit?: Minor;
  studentId?: string | null;
}

export async function postJournal(
  tx: Tx,
  entry: { date?: Date; memo: string; sourceType?: string; sourceId?: string; postedById?: string | null; reversesId?: string },
  lines: PostingLine[],
) {
  const clean = lines.filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0);
  const d = clean.reduce((a, l) => a + (l.debit ?? 0), 0);
  const c = clean.reduce((a, l) => a + (l.credit ?? 0), 0);
  if (d !== c || d === 0) throw new Error(`Unbalanced journal: debit ${d} credit ${c}`);
  const number = await nextNumber(tx, "journal", { prefix: "JV/{YYYY}/", padding: 6 });
  const resolved = await Promise.all(clean.map(async (l) => ({ ...l, accountId: typeof l.account === "string" ? await accountId(tx, l.account) : l.account.id })));
  return tx.journalEntry.create({
    data: {
      number, date: entry.date ?? new Date(), memo: entry.memo, sourceType: entry.sourceType ?? null, sourceId: entry.sourceId ?? null, postedById: entry.postedById ?? null, reversesId: entry.reversesId ?? null,
      lines: { create: resolved.map((l) => ({ accountId: l.accountId, debit: fromMinor(l.debit ?? 0), credit: fromMinor(l.credit ?? 0), studentId: l.studentId ?? null })) },
    },
  });
}

/** Reverse every entry posted for a source (e.g. a reversed payment), once. */
export async function reverseEntriesFor(tx: Tx, sourceType: string, sourceId: string, memo: string, actorId: string | null) {
  const entries = await tx.journalEntry.findMany({ where: { sourceType, sourceId, reversesId: null }, include: { lines: true } });
  for (const e of entries) {
    if (await tx.journalEntry.findUnique({ where: { reversesId: e.id } })) continue;
    await postJournal(
      tx,
      { memo: `${memo} (reverses ${e.number})`, sourceType, sourceId, postedById: actorId, reversesId: e.id },
      e.lines.map((l) => ({ account: { id: l.accountId }, debit: Math.round(Number(l.credit) * 100), credit: Math.round(Number(l.debit) * 100), studentId: l.studentId })),
    );
  }
}

// ───────────────────────── Manual entries & queries ─────────────────────────

const accountSchema = z.object({ code: z.string().trim().regex(/^[0-9A-Z.-]{2,12}$/), name: z.string().trim().min(2).max(120), type: z.enum(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]), parentId: z.string().nullable().optional() });

export async function saveAccount(ctx: AuthContext, id: string | null, raw: unknown) {
  if (!can(ctx, "ledger.manage")) throw forbidden();
  const v = accountSchema.parse(raw);
  const a = id ? await db.ledgerAccount.update({ where: { id }, data: { name: v.name, parentId: v.parentId ?? null } }) : await db.ledgerAccount.create({ data: { ...v, parentId: v.parentId ?? null } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: id ? "ledger.account.update" : "ledger.account.create", resourceType: "ledgerAccount", resourceId: a.id, summary: `${v.code} ${v.name}` });
  return a;
}

const manualSchema = z.object({
  date: z.coerce.date(),
  memo: z.string().trim().min(5).max(300),
  lines: z.array(z.object({ accountId: z.string().min(1), debit: z.number().min(0), credit: z.number().min(0) })).min(2).max(30),
});

export async function postManualEntry(ctx: AuthContext, raw: unknown) {
  if (!can(ctx, "ledger.manage")) throw forbidden();
  const v = manualSchema.parse(raw);
  const lines = v.lines.map((l) => ({ account: { id: l.accountId }, debit: Math.round(l.debit * 100), credit: Math.round(l.credit * 100) }));
  if (lines.some((l) => l.debit > 0 && l.credit > 0)) throw invalid("A line is either a debit or a credit.");
  const d = lines.reduce((a, l) => a + l.debit, 0);
  if (d !== lines.reduce((a, l) => a + l.credit, 0)) throw invalid("Debits and credits must be equal.");
  return db.$transaction(async (tx) => {
    const e = await postJournal(tx, { date: v.date, memo: v.memo, sourceType: "manual", postedById: ctx.user.id }, lines);
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "ledger.journal.post", resourceType: "journalEntry", resourceId: e.id, summary: `${e.number}: ${v.memo}` }, tx);
    return e;
  });
}

export async function reverseManualEntry(ctx: AuthContext, entryId: string, reason: string) {
  if (!can(ctx, "ledger.manage")) throw forbidden();
  const e = await db.journalEntry.findUnique({ where: { id: entryId } });
  if (!e) throw notFound("Journal entry");
  if (e.sourceType !== "manual") throw workflowError("System postings are reversed by reversing their source document.");
  if (e.reversesId || (await db.journalEntry.findUnique({ where: { reversesId: e.id } }))) throw workflowError("This entry is already a reversal or has been reversed.");
  await db.$transaction(async (tx) => {
    const lines = await tx.journalLine.findMany({ where: { entryId } });
    await postJournal(tx, { memo: `Reversal: ${reason} (reverses ${e.number})`, sourceType: "manual", postedById: ctx.user.id, reversesId: e.id }, lines.map((l) => ({ account: { id: l.accountId }, debit: Math.round(Number(l.credit) * 100), credit: Math.round(Number(l.debit) * 100) })));
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "ledger.journal.reverse", resourceType: "journalEntry", resourceId: entryId, summary: reason }, tx);
  });
}

/** Trial balance: debit and credit totals per account. */
export async function trialBalance(asOf?: Date) {
  const rows = await db.journalLine.groupBy({ by: ["accountId"], where: asOf ? { entry: { date: { lte: asOf } } } : {}, _sum: { debit: true, credit: true } });
  const accounts = await db.ledgerAccount.findMany({ orderBy: { code: "asc" } });
  return accounts.map((a) => {
    const r = rows.find((x) => x.accountId === a.id);
    const debit = Math.round(Number(r?._sum.debit ?? 0) * 100);
    const credit = Math.round(Number(r?._sum.credit ?? 0) * 100);
    return { ...a, debit, credit, balance: debit - credit };
  });
}
