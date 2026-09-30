import { describe, expect, it } from "vitest";
import { toMinor } from "@/lib/domain/money";
import { db } from "@/server/db";
import { createAppraisalCycle, submitManagerReview, submitSelfReview } from "@/server/services/appraisals";
import { applyLeave, cancelLeave, employeeWhere, markStaffAttendance, maskedPayDetails, setPayDetails } from "@/server/services/hr";
import { trialBalance } from "@/server/services/ledger";
import { computePayrollRun, createPayrollRun, loadPayslipFor, markPayrollPaid, setEmployeeSalary, submitPayrollRun } from "@/server/services/payroll";
import { decideTask } from "@/server/services/workflow";
import { as } from "./helpers";

const employee = async (handle: string) => db.employee.findFirstOrThrow({ where: { user: { email: `${handle}@example.edu` } } });
const leaveType = (code: string) => db.leaveType.findUniqueOrThrow({ where: { code } });
const balance = async (employeeId: string, code: string) => db.leaveBalance.findFirstOrThrow({ where: { employeeId, year: 2026, leaveType: { code } } });
const pendingTasks = async (resourceId: string) => db.workflowTask.findMany({ where: { status: "PENDING", instance: { resourceId } }, include: { assignee: true } });
const approveAll = async (resourceId: string) => {
  for (let i = 0; i < 6; i++) {
    const [t] = await pendingTasks(resourceId);
    if (!t) return;
    await decideTask(await as(t.assignee.email.replace("@example.edu", "")), t.id, { decision: "approve" });
  }
};
const ledgerBalanced = async () => {
  const tb = await trialBalance();
  expect(tb.reduce((a, x) => a + x.debit, 0)).toBe(tb.reduce((a, x) => a + x.credit, 0));
};

describe("leave", () => {
  it("routes to the reporting manager, charges the balance on approval and marks attendance", async () => {
    const me = await as("faculty.cs1");
    const emp = await employee("faculty.cs1");
    const cl = await leaveType("CL");
    const before = await balance(emp.id, "CL");
    const r = await applyLeave(me, { leaveTypeId: cl.id, fromDate: "2026-11-09", toDate: "2026-11-10", reason: "Attending a family wedding" });
    expect(r.status).toBe("PENDING");
    expect(r.days).toBeGreaterThan(0);
    const tasks = await pendingTasks(r.id);
    expect(tasks.map((t) => t.assignee.email)).toEqual(["hod.cs@example.edu"]);
    // Overlapping and over-balance applications are refused.
    await expect(applyLeave(me, { leaveTypeId: cl.id, fromDate: "2026-11-10", toDate: "2026-11-10", reason: "Another day off" })).rejects.toThrow(/already have leave/);
    await approveAll(r.id);
    const after = await db.leaveRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.status).toBe("APPROVED");
    expect((await balance(emp.id, "CL")).used).toBe(before.used + r.days);
    expect(await db.staffAttendance.count({ where: { employeeId: emp.id, source: "LEAVE", date: { gte: r.fromDate, lte: r.toDate } } })).toBe(r.days);
    // Cancelling approved leave before it starts restores the balance and clears the marks.
    await cancelLeave(me, r.id, "Plans changed");
    expect((await balance(emp.id, "CL")).used).toBe(before.used);
    expect(await db.staffAttendance.count({ where: { employeeId: emp.id, source: "LEAVE", date: { gte: r.fromDate, lte: r.toDate } } })).toBe(0);
  });

  it("refuses leave beyond the available balance and policy limits", async () => {
    const me = await as("faculty.cs1");
    const cl = await leaveType("CL");
    await expect(applyLeave(me, { leaveTypeId: cl.id, fromDate: "2026-12-01", toDate: "2026-12-05", reason: "Long break needed" })).rejects.toThrow(/At most 3 days/);
    const el = await leaveType("EL");
    await expect(applyLeave(me, { leaveTypeId: el.id, fromDate: "2026-12-14", toDate: "2026-12-14", halfDay: "FIRST_HALF", reason: "Half day errand" })).rejects.toThrow(/half day/);
  });

  it("adds HR for longer leave and falls back to the HoD without a manager", async () => {
    const emp = await employee("faculty.cs2");
    await db.employee.update({ where: { id: emp.id }, data: { reportingToId: null } });
    const el = await leaveType("EL");
    const r = await applyLeave(await as("faculty.cs2"), { leaveTypeId: el.id, fromDate: "2026-12-07", toDate: "2026-12-12", reason: "Visiting family abroad" });
    expect(r.days).toBeGreaterThan(3);
    expect((await pendingTasks(r.id)).map((t) => t.assignee.email)).toEqual(["hod.cs@example.edu"]);
    const [t] = await pendingTasks(r.id);
    await decideTask(await as("hod.cs"), t.id, { decision: "approve" });
    expect((await pendingTasks(r.id)).map((t) => t.assignee.email)).toEqual(["hr@example.edu"]);
    await approveAll(r.id);
    expect((await db.leaveRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("APPROVED");
    await db.employee.update({ where: { id: emp.id }, data: { reportingToId: emp.reportingToId } });
  });

  it("lets HR apply on an employee's behalf but not outside scope", async () => {
    const cl = await leaveType("CL");
    const emp = await employee("faculty.com1");
    const r = await applyLeave(await as("hr"), { leaveTypeId: cl.id, fromDate: "2026-11-16", toDate: "2026-11-16", reason: "Applied by HR on request" }, emp.id);
    expect(r.employeeId).toBe(emp.id);
    await expect(applyLeave(await as("hod.cs"), { leaveTypeId: cl.id, fromDate: "2026-11-17", toDate: "2026-11-17", reason: "Should not be allowed" }, emp.id)).rejects.toThrow();
  });
});

describe("employee records & attendance", () => {
  it("scopes employee visibility by department", async () => {
    const hod = await as("hod.cs");
    const visible = await db.employee.findMany({ where: employeeWhere(hod), include: { department: true } });
    expect(visible.length).toBeGreaterThan(2);
    expect(visible.every((e) => e.department?.code === "CS" || e.reportingToId === hod.subject.employeeId)).toBe(true);
    const faculty = await as("faculty.cs1");
    expect(await db.employee.count({ where: employeeWhere(faculty) })).toBe(0);
    expect((await as("hr")).subject.employeeId).toBeTruthy();
  });

  it("marks staff attendance within scope and keeps approved leave", async () => {
    const hod = await as("hod.cs");
    const cs1 = await employee("faculty.cs1");
    const com = await employee("faculty.com1");
    const r = await markStaffAttendance(hod, { date: "2026-09-26", entries: [{ employeeId: cs1.id, status: "PRESENT" }] });
    expect(r.saved).toBe(1);
    await expect(markStaffAttendance(hod, { date: "2026-09-26", entries: [{ employeeId: com.id, status: "ABSENT" }] })).rejects.toThrow(/outside your scope/);
    const cs2 = await employee("faculty.cs2");
    const kept = await markStaffAttendance(hod, { date: "2026-09-08", entries: [{ employeeId: cs2.id, status: "ABSENT" }] });
    expect(kept.kept).toBe(1);
    expect((await db.staffAttendance.findFirstOrThrow({ where: { employeeId: cs2.id, date: new Date("2026-09-08T00:00:00Z") } })).status).toBe("ON_LEAVE");
  });

  it("stores bank details encrypted and shows them masked", async () => {
    const hr = await as("hr");
    const emp = await employee("faculty.cs1");
    await setPayDetails(hr, emp.id, { bankAccount: "123456789012", bankIfsc: "SBIN0001234", taxId: "ABCDE1234F" });
    const row = await db.employee.findUniqueOrThrow({ where: { id: emp.id } });
    expect(row.bankAccountEnc).not.toContain("123456789012");
    expect(maskedPayDetails(row)).toMatchObject({ bankAccount: "••••••••9012", bankIfsc: "SBIN0001234", taxId: "••••••234F" });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "hr.employee.paydetails", resourceId: emp.id }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify([audit.summary, audit.oldValue, audit.newValue])).not.toContain("123456789012");
  });
});

describe("payroll", () => {
  it("computes, approves through Finance and Registrar, accrues, pays and releases payslips", async () => {
    const hr = await as("hr");
    const run = await createPayrollRun(hr, "2026-09");
    expect(run.workingDays).toBe(30);
    const totals = await computePayrollRun(hr, run.id);
    expect(totals.employees).toBeGreaterThan(20);
    let slips = await db.payslip.findMany({ where: { runId: run.id } });
    for (const s of slips) expect(toMinor(s.net)).toBe(toMinor(s.gross) - toMinor(s.deductions));
    // Recomputing is allowed until submission.
    const again = await computePayrollRun(hr, run.id);
    expect(again.net).toBe(totals.net);
    slips = await db.payslip.findMany({ where: { runId: run.id } });

    await submitPayrollRun(hr, run.id);
    expect((await db.payrollRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("IN_APPROVAL");
    await expect(computePayrollRun(hr, run.id)).rejects.toThrow(/can no longer be recomputed/);
    const first = await pendingTasks(run.id);
    expect(first.map((t) => t.assignee.email)).toEqual(["finance@example.edu"]);
    await approveAll(run.id);
    const approved = await db.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(approved.status).toBe("APPROVED");
    const accrual = await db.journalEntry.findFirstOrThrow({ where: { sourceType: "payrollRun", sourceId: run.id }, include: { lines: { include: { account: true } } } });
    const payable = accrual.lines.filter((l) => l.account.code === "2300").reduce((a, l) => a + toMinor(l.credit), 0);
    expect(payable).toBe(Math.round(totals.net * 100));
    await ledgerBalanced();

    // Approved payslips are frozen by the database.
    await expect(db.payslip.update({ where: { id: slips[0].id }, data: { net: "1.00", gross: "1.00", deductions: "0.00" } })).rejects.toThrow(/approved payroll/);
    // Pay changes cannot reach back into an approved month.
    const cs1 = await employee("faculty.cs1");
    const st = await db.salaryStructure.findFirstOrThrow({ where: { status: "ACTIVE", code: "TEACH-7CPC" } });
    await expect(setEmployeeSalary(hr, cs1.id, { structureId: st.id, basicMonthly: 60000, effectiveFrom: "2026-09-15" })).rejects.toThrow(/already approved/);

    await expect(markPayrollPaid(hr, run.id, "NEFT-1")).rejects.toThrow();
    await markPayrollPaid(await as("accounts"), run.id, "NEFT batch 20261001-01");
    expect((await db.payrollRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("PAID");
    await ledgerBalanced();

    const mine = slips.find((s) => s.employeeId === cs1.id)!;
    expect((await loadPayslipFor(await as("faculty.cs1"), mine.id)).id).toBe(mine.id);
    await expect(loadPayslipFor(await as("faculty.cs2"), mine.id)).rejects.toThrow(/not found/);
  });
});

describe("appraisal", () => {
  it("runs self-review then manager review with a weighted score", async () => {
    const now = Date.now();
    await createAppraisalCycle(await as("hr"), { name: "Annual appraisal 2026 (test)", year: 2026, opensAt: new Date(now - 86_400_000), closesAt: new Date(now + 30 * 86_400_000), criteria: [{ key: "teaching", label: "Teaching", weight: 60 }, { key: "research", label: "Research", weight: 40 }] });
    const emp = await employee("faculty.cs1");
    const a = await db.appraisal.findFirstOrThrow({ where: { employeeId: emp.id, cycle: { name: "Annual appraisal 2026 (test)" } } });
    await expect(submitManagerReview(await as("hod.cs"), a.id, { ratings: { teaching: 4, research: 3 }, comments: "Premature review attempt" })).rejects.toThrow(/self-review/);
    await submitSelfReview(await as("faculty.cs1"), a.id, { ratings: { teaching: 5, research: 3 }, comments: "Taught three courses and published one paper." });
    await expect(submitManagerReview(await as("faculty.cs2"), a.id, { ratings: { teaching: 4, research: 3 }, comments: "Not the reviewer" })).rejects.toThrow(/not found/);
    const { score } = await submitManagerReview(await as("hod.cs"), a.id, { ratings: { teaching: 4, research: 3 }, comments: "Strong teaching; research improving." });
    expect(score).toBe(3.6);
  });
});
