import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { toMinor } from "@/lib/domain/money";
import { type AuthContext, can, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";
import { helpdeskStats } from "@/server/services/helpdesk";
import { placementStats } from "@/server/services/placements";
import { attendancePolicy } from "@/server/services/settings";

/**
 * Institution analytics. Each section is computed only for users holding the matching permission, and
 * department-scoped permissions restrict the figures to those departments. Aggregates only — no personal rows.
 */

const deptFilter = (ctx: AuthContext, perm: Parameters<typeof scopeOf>[1]) => {
  const s = scopeOf(ctx, perm);
  return s === null ? null : s;
};
const monthKey = (d: Date) => d.toISOString().slice(0, 7);
function lastMonths(n: number) {
  const out: string[] = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = n - 1; i >= 0; i--) out.push(monthKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1))));
  return out;
}

export async function enrolmentInsights(ctx: AuthContext) {
  if (!can(ctx, "student.view")) return null;
  const scope = deptFilter(ctx, "student.view");
  const where: Prisma.StudentWhereInput = { deletedAt: null, ...(scope ? { departmentId: { in: scope } } : {}) };
  const [byProgram, byStatus, programs] = await Promise.all([
    db.student.groupBy({ by: ["programId"], where: { ...where, status: "ACTIVE" }, _count: true }),
    db.student.groupBy({ by: ["status"], where, _count: true }),
    db.program.findMany({ select: { id: true, code: true } }),
  ]);
  const code = new Map(programs.map((p) => [p.id, p.code]));
  return {
    active: byStatus.find((s) => s.status === "ACTIVE")?._count ?? 0,
    byProgram: byProgram.map((p) => ({ program: code.get(p.programId) ?? "?", students: p._count })).sort((a, b) => b.students - a.students),
    byStatus: byStatus.map((s) => ({ status: s.status.toLowerCase().replace("_", " "), students: s._count })),
  };
}

export async function attendanceInsights(ctx: AuthContext) {
  if (!can(ctx, "attendance.view")) return null;
  const scope = deptFilter(ctx, "attendance.view");
  const policy = await attendancePolicy();
  const rows = await db.attendanceRecord.groupBy({
    by: ["mark"],
    where: { meeting: { status: "HELD", offering: { term: { isCurrent: true }, ...(scope ? { course: { departmentId: { in: scope } } } : {}) } } },
    _count: true,
  });
  const counted = rows.filter((r) => !policy.excludedMarks.includes(r.mark));
  const total = counted.reduce((a, r) => a + r._count, 0);
  const present = counted.filter((r) => policy.presentMarks.includes(r.mark)).reduce((a, r) => a + r._count, 0);
  return { percent: total ? Math.round((present / total) * 1000) / 10 : null, marks: total, minimum: policy.minimumPercent };
}

export async function resultInsights(ctx: AuthContext) {
  if (!can(ctx, "result.view")) return null;
  const scope = deptFilter(ctx, "result.view");
  const results = await db.courseResult.findMany({
    where: { isCurrent: true, publishedAt: { not: null }, status: { in: ["PASS", "FAIL", "ABSENT"] }, ...(scope ? { student: { departmentId: { in: scope } } } : {}) },
    select: { status: true, run: { select: { term: { select: { name: true, startDate: true } } } } },
  });
  const byTerm = new Map<string, { term: string; start: number; pass: number; total: number }>();
  for (const r of results) {
    const t = r.run.term;
    const e = byTerm.get(t.name) ?? { term: t.name, start: t.startDate.getTime(), pass: 0, total: 0 };
    e.total++;
    if (r.status === "PASS") e.pass++;
    byTerm.set(t.name, e);
  }
  return [...byTerm.values()].sort((a, b) => a.start - b.start).map((e) => ({ term: e.term, passPercent: Math.round((e.pass / e.total) * 1000) / 10, results: e.total }));
}

export async function financeInsights(ctx: AuthContext) {
  if (!can(ctx, "finance.view")) return null;
  const scope = deptFilter(ctx, "finance.view");
  const studentScope = scope ? { student: { departmentId: { in: scope } } } : {};
  const months = lastMonths(12);
  const since = new Date(`${months[0]}-01T00:00:00Z`);
  const [payments, open, overdue] = await Promise.all([
    db.payment.findMany({ where: { status: "SUCCEEDED", receivedAt: { gte: since }, ...studentScope }, select: { amount: true, receivedAt: true } }),
    db.invoice.aggregate({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] }, ...studentScope }, _sum: { total: true, amountPaid: true } }),
    db.invoice.aggregate({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: new Date() }, ...studentScope }, _sum: { total: true, amountPaid: true }, _count: true }),
  ]);
  const byMonth = new Map(months.map((m) => [m, 0]));
  for (const p of payments) byMonth.set(monthKey(p.receivedAt), (byMonth.get(monthKey(p.receivedAt)) ?? 0) + toMinor(p.amount));
  return {
    collections: months.map((m) => ({ month: m.slice(2), amount: Math.round((byMonth.get(m) ?? 0) / 100) })),
    outstanding: (toMinor(open._sum.total) - toMinor(open._sum.amountPaid)) / 100,
    overdue: (toMinor(overdue._sum.total) - toMinor(overdue._sum.amountPaid)) / 100,
    overdueInvoices: overdue._count,
  };
}

export async function payrollInsights(ctx: AuthContext) {
  if (!can(ctx, "payroll.view") && !can(ctx, "payroll.process")) return null;
  const runs = await db.payrollRun.findMany({ where: { status: { in: ["APPROVED", "PAID"] } }, orderBy: { period: "desc" }, take: 12, select: { period: true, totals: true } });
  return runs.reverse().map((r) => ({ month: r.period.slice(2), net: Math.round((r.totals as { net?: number } | null)?.net ?? 0), gross: Math.round((r.totals as { gross?: number } | null)?.gross ?? 0) }));
}

export async function researchInsights(ctx: AuthContext) {
  if (!can(ctx, "research.view")) return null;
  const scope = deptFilter(ctx, "research.view");
  const d = scope ? { departmentId: { in: scope } } : {};
  const [pubs, grants] = await Promise.all([
    db.publication.groupBy({ by: ["year"], where: { verifiedAt: { not: null }, ...d }, _count: true, orderBy: { year: "asc" } }),
    db.researchProject.aggregate({ where: { status: { in: ["SANCTIONED", "COMPLETED"] }, ...d }, _sum: { sanctionedAmount: true }, _count: true }),
  ]);
  return { publications: pubs.slice(-8).map((p) => ({ year: String(p.year), publications: p._count })), grants: toMinor(grants._sum.sanctionedAmount) / 100, projects: grants._count };
}

export async function libraryInsights(ctx: AuthContext) {
  if (!can(ctx, "library.circulate")) return null;
  const months = lastMonths(6);
  const loans = await db.libraryLoan.findMany({ where: { issuedAt: { gte: new Date(`${months[0]}-01T00:00:00Z`) } }, select: { issuedAt: true } });
  const by = new Map(months.map((m) => [m, 0]));
  for (const l of loans) by.set(monthKey(l.issuedAt), (by.get(monthKey(l.issuedAt)) ?? 0) + 1);
  const [onLoan, overdue] = await Promise.all([db.libraryLoan.count({ where: { returnedAt: null } }), db.libraryLoan.count({ where: { returnedAt: null, dueAt: { lt: new Date() } } })]);
  return { circulation: months.map((m) => ({ month: m.slice(2), loans: by.get(m) ?? 0 })), onLoan, overdue };
}

export async function admissionInsights(ctx: AuthContext) {
  if (!can(ctx, "admission.view")) return null;
  const rows = await db.admissionApplication.groupBy({ by: ["status"], _count: true, where: { cycle: { closesAt: { gte: new Date(Date.now() - 365 * 86_400_000) } } } });
  const n = (s: string[]) => rows.filter((r) => s.includes(r.status)).reduce((a, r) => a + r._count, 0);
  return [
    { stage: "Applied", count: n(["SUBMITTED", "VERIFIED", "REJECTED", "OFFERED", "ACCEPTED", "DECLINED", "ENROLLED", "WITHDRAWN"]) },
    { stage: "Verified", count: n(["VERIFIED", "OFFERED", "ACCEPTED", "DECLINED", "ENROLLED"]) },
    { stage: "Offered", count: n(["OFFERED", "ACCEPTED", "DECLINED", "ENROLLED"]) },
    { stage: "Accepted", count: n(["ACCEPTED", "ENROLLED"]) },
    { stage: "Enrolled", count: n(["ENROLLED"]) },
  ];
}

export async function operationsInsights(ctx: AuthContext) {
  return {
    helpdesk: can(ctx, "helpdesk.agent") || can(ctx, "helpdesk.manage") ? await helpdeskStats() : null,
    placements: can(ctx, "placement.manage") ? await placementStats() : null,
  };
}

