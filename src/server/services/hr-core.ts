import "server-only";
import { eachDay, isWorkingDay, ymd, type WorkCalendar } from "@/lib/domain/hr";
import { toMinor, type Minor } from "@/lib/domain/money";
import { db, type Tx } from "@/server/db";
import { workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { emitEvent } from "@/server/services/events";
import { postJournal, type PostingLine } from "@/server/services/ledger";
import { notify } from "@/server/services/notifications";
import { getSetting } from "@/server/services/settings";

/**
 * HR operations shared by the HR services and the workflow completion hooks (which run inside the
 * approval transaction). Nothing here imports the workflow service.
 */

type Actor = { id: string | null; name: string };

/** Staff working calendar: the configured work week and institution holidays (calendar events of kind HOLIDAY). */
export async function workCalendar(from: Date, to: Date, tx: Tx | typeof db = db): Promise<WorkCalendar> {
  const [hr, events] = await Promise.all([
    getSetting("hr"),
    tx.calendarEvent.findMany({ where: { kind: "HOLIDAY", startDate: { lte: to }, endDate: { gte: from } }, select: { startDate: true, endDate: true } }),
  ]);
  const holidays = new Set<string>();
  for (const e of events) for (const d of eachDay(e.startDate, e.endDate)) holidays.add(ymd(d));
  return { workWeek: hr.workWeek, holidays };
}

// ───────────────────────── Leave outcomes ─────────────────────────

export async function applyLeaveApproval(tx: Tx, leaveRequestId: string, actor: Actor) {
  const r = await tx.leaveRequest.findUniqueOrThrow({ where: { id: leaveRequestId }, include: { leaveType: true, employee: { select: { userId: true, firstName: true, lastName: true } } } });
  if (r.status !== "PENDING") throw workflowError(`This leave request is already ${r.status.toLowerCase()}.`);
  const year = r.fromDate.getUTCFullYear();
  if (r.leaveType.paid) {
    const bal = await tx.leaveBalance.findUnique({ where: { employeeId_leaveTypeId_year: { employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, year } } });
    if (!bal) throw workflowError("No leave balance exists for this leave type and year.");
    // Guarded update: the balance may have been consumed by another approval since the request was made.
    const left = bal.entitled + bal.carriedForward - bal.used;
    if (r.days > left + 1e-9) throw workflowError(`Only ${left} day(s) of ${r.leaveType.name} remain; the request is for ${r.days}. Return it to the applicant.`);
    await tx.leaveBalance.update({ where: { id: bal.id }, data: { used: { increment: r.days } } });
  }
  await tx.leaveRequest.update({ where: { id: r.id }, data: { status: "APPROVED", decidedAt: new Date() } });
  // Mark the working days as on leave (overrides an absence already marked for those days).
  const cal = await workCalendar(r.fromDate, r.toDate, tx);
  for (const d of eachDay(r.fromDate, r.toDate).filter((x) => isWorkingDay(x, cal))) {
    const status = r.halfDay ? "HALF_DAY" : "ON_LEAVE";
    await tx.staffAttendance.upsert({
      where: { employeeId_date: { employeeId: r.employeeId, date: d } },
      create: { employeeId: r.employeeId, date: d, status, source: "LEAVE", remarks: r.leaveType.code, markedById: actor.id },
      update: { status, source: "LEAVE", remarks: r.leaveType.code, markedById: actor.id },
    });
  }
  await emitEvent(tx, { type: "LeaveApproved", aggregateType: "leaveRequest", aggregateId: r.id, payload: { employeeId: r.employeeId, days: r.days, leaveType: r.leaveType.code }, actorId: actor.id ?? undefined });
}

export async function setLeaveOutcome(tx: Tx, leaveRequestId: string, status: "REJECTED" | "RETURNED" | "CANCELLED") {
  await tx.leaveRequest.updateMany({ where: { id: leaveRequestId, status: { in: ["PENDING", "RETURNED"] } }, data: { status, decidedAt: new Date() } });
}

/** Cancel approved leave that has not started yet: restore the balance and clear the attendance marks. */
export async function revokeApprovedLeave(tx: Tx, leaveRequestId: string, actor: Actor) {
  const r = await tx.leaveRequest.findUniqueOrThrow({ where: { id: leaveRequestId }, include: { leaveType: true } });
  if (r.status !== "APPROVED") return;
  if (r.leaveType.paid) {
    await tx.leaveBalance.update({ where: { employeeId_leaveTypeId_year: { employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, year: r.fromDate.getUTCFullYear() } }, data: { used: { decrement: r.days } } });
  }
  await tx.staffAttendance.deleteMany({ where: { employeeId: r.employeeId, date: { gte: r.fromDate, lte: r.toDate }, source: "LEAVE" } });
  await tx.leaveRequest.update({ where: { id: r.id }, data: { status: "CANCELLED", decidedAt: new Date() } });
  await audit({ actorId: actor.id, actorName: actor.name, action: "hr.leave.cancel", resourceType: "leaveRequest", resourceId: r.id, summary: `Approved leave cancelled; ${r.days} day(s) restored` }, tx);
}

// ───────────────────────── Payroll postings ─────────────────────────

interface SlipLine { code: string; name: string; kind: string; calc?: string; amount: number }

/**
 * Accrue an approved payroll run in the ledger:
 *   Dr salary expense (earnings; a component's own account when set) and employer contributions
 *   Cr salaries payable (net), tax deducted at source payable, statutory deductions payable.
 */
export async function postPayrollAccrual(tx: Tx, runId: string, actor: Actor) {
  const run = await tx.payrollRun.findUniqueOrThrow({ where: { id: runId }, include: { payslips: true } });
  if (run.status !== "IN_APPROVAL") throw workflowError(`Payroll ${run.period} is ${run.status.toLowerCase()}; only a run in approval can be approved.`);
  const comps = await tx.salaryComponent.findMany({ select: { code: true, accountId: true } });
  const byCode = new Map(comps.map((c) => [c.code, c]));
  const debit = new Map<string, Minor>(); // key: account id or std key
  const credit = new Map<string, Minor>();
  const add = (m: Map<string, Minor>, k: string, v: Minor) => v && m.set(k, (m.get(k) ?? 0) + v);
  let net = 0;
  for (const p of run.payslips) {
    net += toMinor(p.net);
    for (const l of p.lines as unknown as SlipLine[]) {
      const amt = Math.round(l.amount * 100);
      const c = byCode.get(l.code);
      const own = c?.accountId ? `id:${c.accountId}` : null;
      if (l.kind === "BASIC" || l.kind === "EARNING") add(debit, own ?? "SALARY_EXPENSE", amt);
      else if (l.kind === "DEDUCTION") add(credit, own ?? (l.calc === "INCOME_TAX" ? "TAX_PAYABLE" : "STATUTORY_PAYABLE"), amt);
      else if (l.kind === "EMPLOYER_CONTRIBUTION") {
        add(debit, own ?? "EMPLOYER_CONTRIBUTIONS", amt);
        add(credit, "STATUTORY_PAYABLE", amt);
      }
    }
  }
  add(credit, "SALARY_PAYABLE", net);
  const acct = (k: string) => (k.startsWith("id:") ? { id: k.slice(3) } : (k as PostingLine["account"]));
  const lines: PostingLine[] = [
    ...[...debit].map(([k, v]) => ({ account: acct(k), debit: v })),
    ...[...credit].map(([k, v]) => ({ account: acct(k), credit: v })),
  ];
  if (lines.length) await postJournal(tx, { memo: `Payroll ${run.period} accrual`, sourceType: "payrollRun", sourceId: run.id, postedById: actor.id }, lines);
  await tx.payrollRun.update({ where: { id: run.id }, data: { status: "APPROVED", approvedAt: new Date() } });
  await emitEvent(tx, { type: "PayrollApproved", aggregateType: "payrollRun", aggregateId: run.id, payload: { period: run.period, employees: run.payslips.length, net }, actorId: actor.id ?? undefined });
  // Payslips become visible to employees once the run is approved.
  const users = await tx.employee.findMany({ where: { id: { in: run.payslips.map((p) => p.employeeId) }, userId: { not: null } }, select: { userId: true } });
  await notify({ userIds: users.map((u) => u.userId!), type: "hr.payslip", title: `Payslip for ${run.period} is available`, link: "/me/payslips" }, tx);
}

export async function reopenPayroll(tx: Tx, runId: string) {
  await tx.payrollRun.updateMany({ where: { id: runId, status: "IN_APPROVAL" }, data: { status: "COMPUTED" } });
}

