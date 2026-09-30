import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { ComponentCalc, ComponentKind } from "@/generated/prisma/enums";
import { computePayslip, dateOnly, eachDay, isWorkingDay, overlap, payableDays, periodRange, leaveDays, type PayComponent } from "@/lib/domain/hr";
import { fromMinor, sum, toMinor } from "@/lib/domain/money";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { workCalendar } from "@/server/services/hr-core";
import { postJournal } from "@/server/services/ledger";
import { getSetting } from "@/server/services/settings";
import { resubmitWorkflow, startWorkflow } from "@/server/services/workflow";
import type { PayrollData } from "@/server/workflow/modules/hr";

/**
 * Payroll: salary components, versioned salary structures, effective-dated employee pay, monthly runs.
 * A run is computed (repeatable while not approved), submitted for approval (hr.payroll workflow), accrued in
 * the ledger on approval, and marked paid by Accounts with the bank reference.
 */

const need = (ctx: AuthContext, perm: "payroll.process" | "payroll.view" | "payroll.disburse") => {
  if (!can(ctx, perm)) throw forbidden();
};
const actorOf = (ctx: AuthContext) => ({ id: ctx.user.id, name: ctx.user.name });

// ───────────────────────── Components & structures ─────────────────────────

export const componentSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,16}$/),
  name: z.string().trim().min(2).max(80),
  kind: z.enum(ComponentKind),
  taxable: z.boolean(),
  accountId: z.string().nullable().optional().or(z.literal("")),
  isActive: z.boolean(),
});

export async function saveComponent(ctx: AuthContext, id: string | null, raw: unknown) {
  need(ctx, "payroll.process");
  const v = componentSchema.parse(raw);
  if (v.code === "BASIC") throw invalid("BASIC is reserved for basic pay.");
  const data = { ...v, accountId: v.accountId || null };
  const c = id ? await db.salaryComponent.update({ where: { id }, data }) : await db.salaryComponent.create({ data });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: id ? "payroll.component.update" : "payroll.component.create", resourceType: "salaryComponent", resourceId: c.id, summary: `${c.code} ${c.name}` });
  return c;
}

export const salaryStructureSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,24}$/),
  name: z.string().trim().min(3).max(160),
  lines: z.array(z.object({
    componentId: z.string().min(1),
    calc: z.enum(ComponentCalc),
    value: z.number().min(0).max(10_000_000),
    cap: z.number().min(0).max(10_000_000).nullable().optional(),
  })).max(40),
}).superRefine((v, c) => {
  const ids = v.lines.map((l) => l.componentId);
  if (new Set(ids).size !== ids.length) c.addIssue({ code: "custom", path: ["lines"], message: "Each component can appear once" });
  v.lines.forEach((l, i) => {
    if (l.calc.startsWith("PERCENT") && l.value > 100) c.addIssue({ code: "custom", path: ["lines", i, "value"], message: "A percentage cannot exceed 100" });
  });
});

/** Draft structures are edited in place; editing an active one creates the next version as a draft. */
export async function saveSalaryStructure(ctx: AuthContext, id: string | null, raw: unknown) {
  need(ctx, "payroll.process");
  const v = salaryStructureSchema.parse(raw);
  const comps = await db.salaryComponent.findMany({ where: { id: { in: v.lines.map((l) => l.componentId) } } });
  if (comps.length !== v.lines.length) throw invalid("Unknown salary component.");
  const kindOf = new Map(comps.map((c) => [c.id, c.kind]));
  for (const l of v.lines) {
    if (l.calc === "INCOME_TAX" && kindOf.get(l.componentId) !== "DEDUCTION") throw invalid("Income tax can only be computed for a deduction component.");
  }
  const lines = v.lines.map((l, i) => ({ componentId: l.componentId, calc: l.calc, value: l.calc === "FIXED" ? l.value.toFixed(2) : l.value.toFixed(4), cap: l.cap != null ? l.cap.toFixed(2) : null, order: i }));
  return db.$transaction(async (tx) => {
    let s;
    if (id) {
      const cur = await tx.salaryStructure.findUnique({ where: { id } });
      if (!cur) throw notFound("Salary structure");
      if (cur.status === "DRAFT") {
        await tx.salaryStructureLine.deleteMany({ where: { structureId: id } });
        s = await tx.salaryStructure.update({ where: { id }, data: { name: v.name, lines: { create: lines } } });
      } else {
        const latest = await tx.salaryStructure.findFirst({ where: { code: cur.code }, orderBy: { version: "desc" } });
        s = await tx.salaryStructure.create({ data: { code: cur.code, version: (latest?.version ?? 0) + 1, name: v.name, lines: { create: lines } } });
      }
    } else {
      if (await tx.salaryStructure.findFirst({ where: { code: v.code } })) throw conflict("A structure with this code exists; edit it to create a new version.");
      s = await tx.salaryStructure.create({ data: { code: v.code, version: 1, name: v.name, lines: { create: lines } } });
    }
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "payroll.structure.save", resourceType: "salaryStructure", resourceId: s.id, summary: `${s.code} v${s.version}: ${lines.length} component(s)` }, tx);
    return s;
  });
}

/**
 * Activate a structure version. Employees on an older version of the same code are moved to it from the
 * given date (a new effective-dated pay row each; history is kept).
 */
export async function activateSalaryStructure(ctx: AuthContext, id: string, effectiveFrom?: string) {
  need(ctx, "payroll.process");
  const s = await db.salaryStructure.findUnique({ where: { id } });
  if (!s) throw notFound("Salary structure");
  const eff = effectiveFrom ? dateOnly(effectiveFrom) : null;
  return db.$transaction(async (tx) => {
    const older = await tx.salaryStructure.findMany({ where: { code: s.code, status: "ACTIVE", id: { not: id } }, select: { id: true } });
    await tx.salaryStructure.updateMany({ where: { id: { in: older.map((o) => o.id) } }, data: { status: "RETIRED" } });
    await tx.salaryStructure.update({ where: { id }, data: { status: "ACTIVE" } });
    let moved = 0;
    if (eff && older.length) {
      const current = await tx.employeeSalary.findMany({ where: { structureId: { in: older.map((o) => o.id) } }, orderBy: { effectiveFrom: "desc" } });
      const latestByEmp = new Map<string, (typeof current)[number]>();
      for (const r of current) if (!latestByEmp.has(r.employeeId)) latestByEmp.set(r.employeeId, r);
      for (const r of latestByEmp.values()) {
        const newest = await tx.employeeSalary.findFirst({ where: { employeeId: r.employeeId }, orderBy: { effectiveFrom: "desc" } });
        if (newest?.id !== r.id || r.effectiveFrom >= eff) continue; // moved to a different structure since, or same date
        await tx.employeeSalary.create({ data: { employeeId: r.employeeId, structureId: id, basicMonthly: r.basicMonthly, effectiveFrom: eff, createdById: ctx.user.id } });
        moved++;
      }
    }
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "payroll.structure.activate", resourceType: "salaryStructure", resourceId: id, summary: `${s.code} v${s.version}${moved ? `; ${moved} employee(s) moved from ${effectiveFrom}` : ""}` }, tx);
    return { moved };
  });
}

/** A pay change: a new effective-dated row (salary history is append-only). */
export async function setEmployeeSalary(ctx: AuthContext, employeeId: string, raw: unknown) {
  need(ctx, "payroll.process");
  const v = z.object({ structureId: z.string().min(1), basicMonthly: z.number().positive().max(100_000_000), effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(raw);
  const [e, s] = await Promise.all([db.employee.findUnique({ where: { id: employeeId } }), db.salaryStructure.findUnique({ where: { id: v.structureId } })]);
  if (!e || e.deletedAt) throw notFound("Employee");
  if (!s || s.status !== "ACTIVE") throw invalid("Choose an active salary structure.");
  const eff = dateOnly(v.effectiveFrom);
  if (eff < e.joinDate) throw invalid("Pay cannot take effect before the joining date.");
  // Pay for a period already approved cannot be changed retrospectively.
  const locked = await db.payrollRun.findFirst({ where: { status: { in: ["APPROVED", "PAID"] }, period: { gte: v.effectiveFrom.slice(0, 7) } }, orderBy: { period: "desc" } });
  if (locked) throw invalid(`Payroll for ${locked.period} is already approved. Make the change effective from a later month (arrears are paid as a separate earning).`);
  if (await db.employeeSalary.findUnique({ where: { employeeId_effectiveFrom: { employeeId, effectiveFrom: eff } } })) throw conflict("A pay change already takes effect on that date.");
  const row = await db.employeeSalary.create({ data: { employeeId, structureId: s.id, basicMonthly: v.basicMonthly.toFixed(2), effectiveFrom: eff, createdById: ctx.user.id } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "payroll.salary.set", resourceType: "employee", resourceId: employeeId, summary: `${e.employeeNo}: ${s.code} v${s.version}, basic ${v.basicMonthly.toFixed(2)} from ${v.effectiveFrom}` });
  return row;
}

// ───────────────────────── Payroll runs ─────────────────────────

export async function createPayrollRun(ctx: AuthContext, period: string) {
  need(ctx, "payroll.process");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw invalid("Choose a month.");
  if (await db.payrollRun.findUnique({ where: { period } })) throw conflict(`A payroll run for ${period} already exists.`);
  const hr = await getSetting("hr");
  const run = await db.payrollRun.create({ data: { period, workingDays: hr.payrollWorkingDays || periodRange(period).days, createdById: ctx.user.id } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "payroll.run.create", resourceType: "payrollRun", resourceId: run.id, summary: period });
  return run;
}

/** Loss-of-pay days for an employee in a period: unauthorised absence and unpaid leave. */
async function lossOfPay(employeeId: string, from: Date, to: Date, absentIsLop: boolean) {
  const [att, unpaid] = await Promise.all([
    absentIsLop ? db.staffAttendance.findMany({ where: { employeeId, date: { gte: from, lte: to }, source: { not: "LEAVE" }, status: { in: ["ABSENT", "HALF_DAY"] } }, select: { status: true } }) : [],
    db.leaveRequest.findMany({ where: { employeeId, status: "APPROVED", leaveType: { paid: false }, fromDate: { lte: to }, toDate: { gte: from } } }),
  ]);
  let lop = att.reduce((a, r) => a + (r.status === "ABSENT" ? 1 : 0.5), 0);
  if (unpaid.length) {
    const cal = await workCalendar(from, to);
    for (const l of unpaid) {
      const o = overlap(l.fromDate, l.toDate, from, to)!;
      lop += l.halfDay ? 0.5 : leaveDays(o.from, o.to, false, cal);
    }
  }
  return lop;
}

/** (Re)compute every payslip of a run. Allowed until the run is submitted for approval. */
export async function computePayrollRun(ctx: AuthContext, runId: string) {
  need(ctx, "payroll.process");
  const run = await db.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw notFound("Payroll run");
  if (!["DRAFT", "COMPUTED"].includes(run.status)) throw workflowError(`Payroll ${run.period} is ${run.status.toLowerCase().replace("_", " ")} and can no longer be recomputed.`);
  const { from, to } = periodRange(run.period);
  const hr = await getSetting("hr");
  const employees = await db.employee.findMany({
    where: { deletedAt: null, joinDate: { lte: to }, OR: [{ exitDate: null }, { exitDate: { gte: from } }], status: { not: "SUSPENDED" } },
    include: { salaries: { where: { effectiveFrom: { lte: to } }, orderBy: { effectiveFrom: "desc" }, take: 1, include: { structure: { include: { lines: { include: { component: true } } } } } } },
    orderBy: { employeeNo: "asc" },
  });
  const slips: Prisma.PayslipCreateManyInput[] = [];
  const skipped: string[] = [];
  for (const e of employees) {
    const sal = e.salaries[0];
    if (!sal) { skipped.push(`${e.employeeNo} (no pay set)`); continue; }
    const lop = await lossOfPay(e.id, from, to, hr.absentIsLossOfPay);
    const payable = payableDays({ workingDays: run.workingDays, periodFrom: from, periodTo: to, joinDate: e.joinDate, exitDate: e.exitDate, lopDays: lop });
    const components: PayComponent[] = sal.structure.lines.filter((l) => l.component.isActive).map((l) => ({
      code: l.component.code, name: l.component.name, kind: l.component.kind, calc: l.calc, value: l.calc === "FIXED" ? toMinor(l.value) : Number(l.value),
      cap: l.cap !== null ? toMinor(l.cap) : null, taxable: l.component.taxable, order: l.order,
    }));
    const p = computePayslip({ basicMonthly: toMinor(sal.basicMonthly), components, workingDays: run.workingDays, payableDays: payable, tax: hr.taxEnabled ? hr.tax : null });
    slips.push({
      runId, employeeId: e.id, basic: fromMinor(p.basic), gross: fromMinor(p.gross), deductions: fromMinor(p.deductions), employerContributions: fromMinor(p.employerContributions), net: fromMinor(p.net),
      workingDays: run.workingDays, lopDays: lop, lines: p.lines.map((l) => ({ ...l, amount: l.amount / 100 })) as unknown as Prisma.InputJsonValue,
    });
  }
  const totals = {
    employees: slips.length, skipped,
    gross: sum(slips.map((s) => toMinor(s.gross as string))) / 100, deductions: sum(slips.map((s) => toMinor(s.deductions as string))) / 100,
    net: sum(slips.map((s) => toMinor(s.net as string))) / 100, employerContributions: sum(slips.map((s) => toMinor(s.employerContributions as string))) / 100,
  };
  await db.$transaction(async (tx) => {
    await tx.payslip.deleteMany({ where: { runId } });
    if (slips.length) await tx.payslip.createMany({ data: slips });
    await tx.payrollRun.update({ where: { id: runId }, data: { status: "COMPUTED", computedAt: new Date(), totals } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "payroll.run.compute", resourceType: "payrollRun", resourceId: runId, summary: `${run.period}: ${slips.length} payslip(s), net ${totals.net.toFixed(2)}${skipped.length ? `, ${skipped.length} skipped` : ""}` }, tx);
  });
  return totals;
}

export async function submitPayrollRun(ctx: AuthContext, runId: string) {
  need(ctx, "payroll.process");
  const run = await db.payrollRun.findUnique({ where: { id: runId }, include: { _count: { select: { payslips: true } } } });
  if (!run) throw notFound("Payroll run");
  if (run.status !== "COMPUTED") throw workflowError("Compute the payroll before submitting it.");
  if (!run._count.payslips) throw workflowError("There are no payslips in this run.");
  const t = run.totals as { employees: number; gross: number; deductions: number; net: number; employerContributions: number };
  const data: PayrollData = { runId, period: run.period, employees: t.employees, gross: t.gross, deductions: t.deductions, net: t.net, employerContributions: t.employerContributions };
  return db.$transaction(async (tx) => {
    await tx.payrollRun.update({ where: { id: runId }, data: { status: "IN_APPROVAL" } });
    const returned = await tx.workflowInstance.findFirst({ where: { resourceType: "payrollRun", resourceId: runId, status: "RETURNED" } });
    if (returned) {
      if (returned.initiatorId !== ctx.user.id) throw workflowError("This payroll was returned to the person who submitted it; they must resubmit or withdraw it.");
      await resubmitWorkflow(tx, actorOf(ctx), returned.id, data as unknown as Record<string, unknown>);
    } else {
      await startWorkflow(tx, actorOf(ctx), { key: "hr.payroll", resourceType: "payrollRun", resourceId: runId, title: `Payroll ${run.period}: ${t.employees} employee(s), net ${t.net.toFixed(2)}`, data: data as unknown as Record<string, unknown> });
    }
  });
}

/** Accounts records the bank transfer of an approved payroll: Dr salaries payable, Cr bank. */
export async function markPayrollPaid(ctx: AuthContext, runId: string, reference: string) {
  need(ctx, "payroll.disburse");
  const ref = String(reference ?? "").trim();
  if (ref.length < 3 || ref.length > 80) throw invalid("Enter the bank transfer reference.");
  const run = await db.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw notFound("Payroll run");
  if (run.status !== "APPROVED") throw workflowError("Only an approved payroll can be marked paid.");
  const net = toMinor((run.totals as { net: number }).net.toFixed(2));
  await db.$transaction(async (tx) => {
    if (net > 0) await postJournal(tx, { memo: `Payroll ${run.period} paid (${ref})`, sourceType: "payrollRun", sourceId: run.id, postedById: ctx.user.id }, [{ account: "SALARY_PAYABLE", debit: net }, { account: "BANK", credit: net }]);
    await tx.payrollRun.update({ where: { id: runId }, data: { status: "PAID", paidAt: new Date(), paymentRef: ref } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "payroll.run.paid", resourceType: "payrollRun", resourceId: runId, summary: `${run.period}: ${(net / 100).toFixed(2)} paid, ref ${ref}` }, tx);
  });
}

export async function deletePayrollRun(ctx: AuthContext, runId: string) {
  need(ctx, "payroll.process");
  const run = await db.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw notFound("Payroll run");
  if (!["DRAFT", "COMPUTED"].includes(run.status)) throw workflowError("Only a run that has not been submitted can be deleted.");
  if (await db.workflowInstance.count({ where: { resourceType: "payrollRun", resourceId: runId, status: { in: ["IN_PROGRESS", "RETURNED"] } } })) throw workflowError("Withdraw the approval request first.");
  await db.payrollRun.delete({ where: { id: runId } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "payroll.run.delete", resourceType: "payrollRun", resourceId: runId, summary: run.period });
}

/** A payslip: its employee once the run is approved, or payroll staff at any time. */
export async function loadPayslipFor(ctx: AuthContext, id: string) {
  const p = await db.payslip.findUnique({ where: { id }, include: { run: true, employee: { include: { department: { select: { name: true } } } } } });
  if (!p) throw notFound("Payslip");
  const own = p.employeeId === ctx.subject.employeeId && ["APPROVED", "PAID"].includes(p.run.status);
  if (!own && !can(ctx, "payroll.view") && !can(ctx, "payroll.process")) throw notFound("Payslip");
  return p;
}

/** Working days in a period under the staff calendar (for information on the run page). */
export async function calendarWorkingDays(period: string) {
  const { from, to } = periodRange(period);
  const cal = await workCalendar(from, to);
  return eachDay(from, to).filter((d) => isWorkingDay(d, cal)).length;
}
