import "server-only";
import { applyLeaveApproval, postPayrollAccrual, reopenPayroll, setLeaveOutcome } from "@/server/services/hr-core";
import { registerWorkflow } from "@/server/workflow/registry";

export interface LeaveData {
  leaveRequestId: string;
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  leaveType: string;
  from: string;
  to: string;
  halfDay: string | null;
  days: number;
  reason: string;
  /** Reporting manager's user account, when the employee has one (approver rule `data_user`) */
  managerUserId: string | null;
  hasManager: boolean;
  /** Set when no manager or head of department other than the applicant can approve; HR then decides */
  escalate: boolean;
}

registerWorkflow({
  key: "hr.leave",
  name: "Staff leave",
  module: "Human resources",
  description: "Leave applications: the reporting manager (or the head of department), then HR for longer leave, then the Registrar for extended leave.",
  defaultSteps: [
    { key: "manager", name: "Reporting manager", approvers: [{ type: "data_user", field: "managerUserId" }], mode: "ANY", condition: { field: "hasManager", op: "eq", value: true }, slaHours: 48, allowReturn: true, allowDelegate: true },
    { key: "hod", name: "Head of department", approvers: [{ type: "role", role: "HOD", scope: "subject_department" }], mode: "ANY", condition: { field: "hasManager", op: "eq", value: false }, slaHours: 48, allowReturn: true, allowDelegate: true },
    { key: "hr", name: "HR verification", approvers: [{ type: "role", role: "HR_OFFICER", scope: "global" }], mode: "ANY", condition: { any: [{ field: "days", op: "gt", value: 3 }, { field: "escalate", op: "eq", value: true }] }, slaHours: 48, allowReturn: true, allowDelegate: true },
    { key: "registrar", name: "Registrar (extended leave)", approvers: [{ type: "role", role: "REGISTRAR", scope: "global" }], mode: "ANY", condition: { field: "days", op: "gt", value: 10 }, slaHours: 72, allowReturn: true, allowDelegate: false },
  ],
  details: (raw) => {
    const d = raw as LeaveData;
    return [
      ["Employee", `${d.employeeName} (${d.employeeNo})`],
      ["Leave", d.leaveType],
      ["Dates", d.from === d.to ? `${d.from}${d.halfDay ? ` (${d.halfDay === "FIRST_HALF" ? "first half" : "second half"})` : ""}` : `${d.from} to ${d.to}`],
      ["Working days", String(d.days)],
      ["Reason", d.reason],
    ];
  },
  href: (i) => `/hr/employees/${(i.data as unknown as LeaveData).employeeId}?tab=leave`,
  async onApproved(tx, instance) {
    await applyLeaveApproval(tx, (instance.data as unknown as LeaveData).leaveRequestId, { id: null, name: "Workflow" });
  },
  async onRejected(tx, instance) {
    await setLeaveOutcome(tx, (instance.data as unknown as LeaveData).leaveRequestId, "REJECTED");
  },
  async onReturned(tx, instance) {
    await setLeaveOutcome(tx, (instance.data as unknown as LeaveData).leaveRequestId, "RETURNED");
  },
  async onCancelled(tx, instance) {
    await setLeaveOutcome(tx, (instance.data as unknown as LeaveData).leaveRequestId, "CANCELLED");
  },
});

export interface PayrollData {
  runId: string;
  period: string;
  employees: number;
  gross: number;
  deductions: number;
  net: number;
  employerContributions: number;
}

registerWorkflow({
  key: "hr.payroll",
  name: "Payroll approval",
  module: "Human resources",
  description: "A computed monthly payroll: Finance Officer, then Registrar. Approval accrues salaries in the ledger and releases payslips.",
  defaultSteps: [
    { key: "finance", name: "Finance Officer", approvers: [{ type: "role", role: "FINANCE_OFFICER", scope: "global" }], mode: "ANY", slaHours: 48, allowReturn: true, allowDelegate: true },
    { key: "registrar", name: "Registrar", approvers: [{ type: "role", role: "REGISTRAR", scope: "global" }], mode: "ANY", slaHours: 48, allowReturn: true, allowDelegate: false },
  ],
  details: (raw) => {
    const d = raw as PayrollData;
    return [["Period", d.period], ["Employees", String(d.employees)], ["Gross", d.gross.toFixed(2)], ["Deductions", d.deductions.toFixed(2)], ["Net pay", d.net.toFixed(2)], ["Employer contributions", d.employerContributions.toFixed(2)]];
  },
  href: (i) => `/hr/payroll/${(i.data as unknown as PayrollData).runId}`,
  async onApproved(tx, instance) {
    await postPayrollAccrual(tx, (instance.data as unknown as PayrollData).runId, { id: null, name: "Workflow" });
  },
  async onRejected(tx, instance) {
    await reopenPayroll(tx, (instance.data as unknown as PayrollData).runId);
  },
  async onReturned(tx, instance) {
    await reopenPayroll(tx, (instance.data as unknown as PayrollData).runId);
  },
  async onCancelled(tx, instance) {
    await reopenPayroll(tx, (instance.data as unknown as PayrollData).runId);
  },
});
