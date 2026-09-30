"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAuth } from "@/server/auth/current";
import { createAppraisalCycle, submitManagerReview, submitSelfReview } from "@/server/services/appraisals";
import {
  adjustLeaveBalance, allocateLeaveBalances, applyLeave, cancelLeave, createEmployee, markStaffAttendance, saveHrSettings, saveLeaveType, savePosition,
  setEmployeeStatus, setPayDetails, updateEmployee,
} from "@/server/services/hr";
import {
  activateSalaryStructure, computePayrollRun, createPayrollRun, deletePayrollRun, markPayrollPaid, saveComponent, saveSalaryStructure, setEmployeeSalary, submitPayrollRun,
} from "@/server/services/payroll";

const hr = () => {
  revalidatePath("/hr", "layout");
  revalidatePath("/me", "layout");
};

export async function createEmployeeAction(_id: string | null, input: unknown) {
  return runAction(async () => { const e = await createEmployee(await requireAuth("hr.manage"), input); hr(); return { id: e.id }; }, "Employee added");
}
export async function updateEmployeeAction(id: string | null, input: unknown) {
  return runAction(async () => { await updateEmployee(await requireAuth("hr.manage"), id!, input); hr(); }, "Employee updated");
}
export async function setEmployeeStatusAction(id: string | null, input: unknown) {
  return runAction(async () => { await setEmployeeStatus(await requireAuth("hr.manage"), id!, input); hr(); }, "Status changed");
}
export async function setPayDetailsAction(id: string | null, input: unknown) {
  return runAction(async () => { await setPayDetails(await requireAuth(), id!, input); hr(); }, "Pay details saved");
}
export async function savePositionAction(id: string | null, input: unknown) {
  return runAction(async () => { await savePosition(await requireAuth("hr.manage"), id, input); hr(); }, "Position saved");
}
export async function saveLeaveTypeAction(id: string | null, input: unknown) {
  return runAction(async () => { await saveLeaveType(await requireAuth("hr.manage"), id, input); hr(); }, "Leave type saved");
}
export async function allocateLeaveAction(year: number) {
  return runAction(async () => { const r = await allocateLeaveBalances(await requireAuth("leave.manage"), year); hr(); return r; });
}
export async function adjustLeaveBalanceAction(id: string | null, input: unknown) {
  return runAction(async () => { await adjustLeaveBalance(await requireAuth("leave.manage"), id!, input); hr(); }, "Balance adjusted");
}
/** `employeeId` is null for one's own leave, or an employee's id when HR applies on their behalf. */
export async function applyLeaveAction(employeeId: string | null, input: unknown) {
  return runAction(async () => { await applyLeave(await requireAuth(), input, employeeId ?? undefined); hr(); revalidatePath("/inbox"); }, "Leave application submitted for approval");
}
export async function cancelLeaveAction(id: string, reason: string) {
  return runAction(async () => { await cancelLeave(await requireAuth(), id, reason); hr(); revalidatePath("/inbox"); }, "Leave cancelled");
}
export async function markStaffAttendanceAction(input: unknown) {
  return runAction(async () => { const r = await markStaffAttendance(await requireAuth("attendance.staff"), input); hr(); return r; }, "Attendance saved");
}
export async function saveHrSettingsAction(input: unknown) {
  return runAction(async () => { await saveHrSettings(await requireAuth(), input); hr(); }, "HR settings saved");
}
export async function saveComponentAction(id: string | null, input: unknown) {
  return runAction(async () => { await saveComponent(await requireAuth("payroll.process"), id, input); hr(); }, "Component saved");
}
export async function saveSalaryStructureAction(id: string | null, input: unknown) {
  return runAction(async () => { const s = await saveSalaryStructure(await requireAuth("payroll.process"), id, input); hr(); return { id: s.id }; }, "Salary structure saved");
}
export async function activateSalaryStructureAction(id: string, effectiveFrom: string | null) {
  return runAction(async () => { const r = await activateSalaryStructure(await requireAuth("payroll.process"), id, effectiveFrom ?? undefined); hr(); return r; }, "Structure activated");
}
export async function setEmployeeSalaryAction(employeeId: string | null, input: unknown) {
  return runAction(async () => { await setEmployeeSalary(await requireAuth("payroll.process"), employeeId!, input); hr(); }, "Pay change recorded");
}
export async function createPayrollRunAction(_id: string | null, input: Record<string, unknown>) {
  return runAction(async () => { const r = await createPayrollRun(await requireAuth("payroll.process"), String(input.period ?? "")); hr(); return { id: r.id }; }, "Payroll run created");
}
export async function computePayrollRunAction(id: string) {
  return runAction(async () => { const t = await computePayrollRun(await requireAuth("payroll.process"), id); hr(); return t; }, "Payroll computed");
}
export async function submitPayrollRunAction(id: string) {
  return runAction(async () => { await submitPayrollRun(await requireAuth("payroll.process"), id); hr(); revalidatePath("/inbox"); }, "Payroll sent for approval");
}
export async function markPayrollPaidAction(id: string, reference: string) {
  return runAction(async () => { await markPayrollPaid(await requireAuth("payroll.disburse"), id, reference); hr(); }, "Payroll marked paid");
}
export async function deletePayrollRunAction(id: string) {
  return runAction(async () => { await deletePayrollRun(await requireAuth("payroll.process"), id); hr(); }, "Payroll run deleted");
}
export async function createAppraisalCycleAction(_id: string | null, input: unknown) {
  return runAction(async () => { await createAppraisalCycle(await requireAuth("appraisal.manage"), input); hr(); }, "Appraisal cycle opened");
}
export async function submitSelfReviewAction(id: string, input: unknown) {
  return runAction(async () => { await submitSelfReview(await requireAuth(), id, input); hr(); }, "Self-review submitted");
}
export async function submitManagerReviewAction(id: string, input: unknown) {
  return runAction(async () => { const r = await submitManagerReview(await requireAuth(), id, input); hr(); return r; }, "Review completed");
}
