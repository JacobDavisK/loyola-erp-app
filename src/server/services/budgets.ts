import "server-only";
import { z } from "zod";
import { budgetPosition, fiscalYearRange } from "@/lib/domain/operations";
import { fromMinor, toMinor } from "@/lib/domain/money";
import { type AuthContext, can, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";

/**
 * Budgets per financial year and department, by ledger account. Spending ("actual") is read from the
 * ledger — journal lines on the account, for the department, dated within the year — and "committed" is
 * approved or ordered purchase requests on the line that have not been billed yet. Purchase requests are
 * checked against what remains.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });

export async function saveBudget(ctx: AuthContext, raw: unknown) {
  if (!can(ctx, "budget.manage")) throw forbidden();
  const v = z.object({ fiscalYear: z.string().regex(/^\d{4}-\d{2}$/, "Use the form 2026-27"), departmentId: z.string().nullable().optional(), notes: z.string().trim().max(2000).nullable().optional() }).parse(raw);
  fiscalYearRange(v.fiscalYear);
  if (await db.budget.findFirst({ where: { fiscalYear: v.fiscalYear, departmentId: v.departmentId ?? null } })) throw conflict("A budget for this year and department exists.");
  const b = await db.budget.create({ data: { fiscalYear: v.fiscalYear, departmentId: v.departmentId ?? null, notes: v.notes ?? null, createdById: ctx.user.id } });
  await audit({ ...actor(ctx), action: "budget.create", resourceType: "budget", resourceId: b.id, summary: v.fiscalYear });
  return b;
}

export async function setBudgetLine(ctx: AuthContext, budgetId: string, raw: unknown) {
  if (!can(ctx, "budget.manage")) throw forbidden();
  const v = z.object({ accountId: z.string(), amount: z.number().min(0).max(1e12), note: z.string().trim().max(300).nullable().optional() }).parse(raw);
  const b = await db.budget.findUnique({ where: { id: budgetId } });
  if (!b) throw notFound("Budget");
  if (b.status === "APPROVED") throw workflowError("An approved budget cannot be changed.");
  const acc = await db.ledgerAccount.findUnique({ where: { id: v.accountId } });
  if (!acc || !["EXPENSE", "ASSET"].includes(acc.type)) throw invalid("Budget lines are for expense or asset accounts.");
  await db.budgetLine.upsert({ where: { budgetId_accountId: { budgetId, accountId: v.accountId } }, create: { budgetId, accountId: v.accountId, amount: fromMinor(Math.round(v.amount * 100)), note: v.note ?? null }, update: { amount: fromMinor(Math.round(v.amount * 100)), note: v.note ?? null } });
}

export async function approveBudget(ctx: AuthContext, budgetId: string) {
  if (!can(ctx, "budget.manage")) throw forbidden();
  const b = await db.budget.findUnique({ where: { id: budgetId }, include: { _count: { select: { lines: true } } } });
  if (!b) throw notFound("Budget");
  if (b.status === "APPROVED") throw workflowError("Already approved.");
  if (!b._count.lines) throw invalid("Add budget lines first.");
  if (b.createdById === ctx.user.id) throw forbidden("Another officer approves the budget you prepared.");
  await db.budget.update({ where: { id: budgetId }, data: { status: "APPROVED", approvedById: ctx.user.id, approvedAt: new Date() } });
  await audit({ ...actor(ctx), action: "budget.approve", resourceType: "budget", resourceId: budgetId, summary: b.fiscalYear });
}

/** Actual and committed amounts (minor units) for each line of a budget. */
async function linePositions(budgetId: string) {
  const b = await db.budget.findUniqueOrThrow({ where: { id: budgetId }, include: { lines: { include: { account: true } } } });
  const { from, to } = fiscalYearRange(b.fiscalYear);
  const out = [];
  for (const l of b.lines) {
    const sums = await db.journalLine.aggregate({ where: { accountId: l.accountId, entry: { date: { gte: from, lt: to } }, ...(b.departmentId ? { departmentId: b.departmentId } : {}) }, _sum: { debit: true, credit: true } });
    const actual = toMinor(sums._sum.debit ?? 0) - toMinor(sums._sum.credit ?? 0);
    const open = await db.purchaseRequest.findMany({ where: { budgetLineId: l.id, status: { in: ["SUBMITTED", "APPROVED", "ORDERED"] } }, include: { orders: { include: { invoices: { where: { status: { in: ["APPROVED", "PAID"] } } } } } } });
    const committed = open.reduce((a, r) => {
      const billed = r.orders.reduce((x, o) => x + o.invoices.reduce((y, i) => y + toMinor(i.amount), 0), 0);
      return a + Math.max(0, toMinor(r.total) - billed);
    }, 0);
    out.push({ line: l, ...budgetPosition(toMinor(l.amount), actual, committed) });
  }
  return { budget: b, lines: out };
}

export async function budgetLineAvailable(lineId: string): Promise<number> {
  const l = await db.budgetLine.findUniqueOrThrow({ where: { id: lineId } });
  const r = await linePositions(l.budgetId);
  return r.lines.find((x) => x.line.id === lineId)!.available;
}

export async function budgetReport(ctx: AuthContext, budgetId: string) {
  const b = await db.budget.findUnique({ where: { id: budgetId } });
  if (!b) throw notFound("Budget");
  if (!can(ctx, "budget.manage") && !(b.departmentId && can(ctx, "budget.view", b.departmentId)) && !(b.departmentId === null && scopeOf(ctx, "budget.view") === null)) throw forbidden();
  return linePositions(budgetId);
}
