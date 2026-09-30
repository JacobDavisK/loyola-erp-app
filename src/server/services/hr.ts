import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { EmployeeCategory, EmployeeStatus, EmploymentType, StaffAttendanceStatus } from "@/generated/prisma/enums";
import { available, carryForward, checkLeave, dateOnly, leaveDays, mask, proratedQuota } from "@/lib/domain/hr";
import { type AuthContext, can, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { decryptString, encryptString } from "@/server/security/crypto";
import { audit } from "@/server/services/audit";
import { revokeApprovedLeave, workCalendar } from "@/server/services/hr-core";
import { nextNumber } from "@/server/services/sequence";
import { getSetting, SETTING_SCHEMAS } from "@/server/services/settings";
import { cancelWorkflow, startWorkflow } from "@/server/services/workflow";
import type { LeaveData } from "@/server/workflow/modules/hr";

/**
 * Human resources: employee records, positions, leave policy and balances, leave applications and staff
 * attendance. Payroll lives in payroll.ts. Object-level access goes through employeeWhere().
 */

const actorOf = (ctx: AuthContext) => ({ id: ctx.user.id, name: ctx.user.name });
const ymdString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** Employees the user may see for a permission: global, their departments, and always themselves. */
export function employeeWhere(ctx: AuthContext, perm: "hr.view" | "attendance.staff" | "leave.manage" | "hr.manage" = "hr.view"): Prisma.EmployeeWhereInput {
  const scope = scopeOf(ctx, perm);
  const base: Prisma.EmployeeWhereInput = { deletedAt: null };
  if (scope === null) return base;
  const or: Prisma.EmployeeWhereInput[] = [];
  if (scope.length) or.push({ departmentId: { in: scope } });
  if (ctx.subject.employeeId) or.push({ reportingTo: { id: ctx.subject.employeeId } });
  if (!or.length) return { id: "__none__" };
  return { ...base, OR: or };
}

export async function loadEmployeeFor(ctx: AuthContext, id: string, perm: Parameters<typeof employeeWhere>[1] = "hr.view") {
  const e = await db.employee.findFirst({ where: { AND: [{ id }, employeeWhere(ctx, perm)] } });
  if (!e) throw notFound("Employee");
  return e;
}

// ───────────────────────── Employees ─────────────────────────

export const employeeSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().max(30).nullable().optional(),
  dateOfBirth: ymdString.nullable().optional().or(z.literal("")),
  gender: z.enum(["MALE", "FEMALE", "OTHER", "UNDISCLOSED"]).nullable().optional().or(z.literal("")),
  category: z.enum(EmployeeCategory),
  employmentType: z.enum(EmploymentType),
  departmentId: z.string().nullable().optional().or(z.literal("")),
  positionId: z.string().nullable().optional().or(z.literal("")),
  designation: z.string().trim().min(2).max(120),
  reportingToId: z.string().nullable().optional().or(z.literal("")),
  joinDate: ymdString,
  confirmationDate: ymdString.nullable().optional().or(z.literal("")),
  specialization: z.string().trim().max(200).nullable().optional(),
  userId: z.string().nullable().optional().or(z.literal("")),
});

const nul = <T>(v: T | "" | undefined | null) => (v === "" || v === undefined ? null : v);

async function checkEmployeeRefs(v: z.infer<typeof employeeSchema>, selfId: string | null) {
  if (v.userId) {
    const other = await db.employee.findFirst({ where: { userId: v.userId, id: selfId ? { not: selfId } : undefined } });
    if (other) throw conflict(`That user account is already linked to ${other.firstName} ${other.lastName} (${other.employeeNo}).`);
    const u = await db.user.findUnique({ where: { id: v.userId }, select: { userType: true } });
    if (!u || u.userType !== "STAFF") throw invalid("Link a staff user account.");
  }
  if (v.reportingToId) {
    if (v.reportingToId === selfId) throw invalid("An employee cannot report to themselves.");
    // Walk up the chain to prevent cycles.
    let cur: string | null = v.reportingToId;
    for (let i = 0; cur && i < 50; i++) {
      if (cur === selfId) throw invalid("That reporting line would create a cycle.");
      cur = (await db.employee.findUnique({ where: { id: cur }, select: { reportingToId: true } }))?.reportingToId ?? null;
    }
  }
}

export async function createEmployee(ctx: AuthContext, raw: unknown) {
  const v = employeeSchema.parse(raw);
  if (!can(ctx, "hr.manage", nul(v.departmentId) ?? undefined)) throw forbidden();
  await checkEmployeeRefs(v, null);
  const hr = await getSetting("hr");
  return db.$transaction(async (tx) => {
    const employeeNo = await nextNumber(tx, "employee", { prefix: hr.employeePrefix, padding: 4 });
    const e = await tx.employee.create({
      data: {
        employeeNo, firstName: v.firstName, lastName: v.lastName, email: v.email, phone: nul(v.phone), dateOfBirth: v.dateOfBirth ? dateOnly(v.dateOfBirth) : null,
        gender: nul(v.gender) as never, category: v.category, employmentType: v.employmentType, departmentId: nul(v.departmentId), positionId: nul(v.positionId),
        designation: v.designation, reportingToId: nul(v.reportingToId), joinDate: dateOnly(v.joinDate), confirmationDate: v.confirmationDate ? dateOnly(v.confirmationDate) : null,
        specialization: nul(v.specialization), userId: nul(v.userId),
      },
    });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "hr.employee.create", resourceType: "employee", resourceId: e.id, summary: `${employeeNo} ${v.firstName} ${v.lastName}` }, tx);
    return e;
  });
}

export async function updateEmployee(ctx: AuthContext, id: string, raw: unknown) {
  const cur = await loadEmployeeFor(ctx, id, "hr.manage");
  const v = employeeSchema.parse(raw);
  if (!can(ctx, "hr.manage", nul(v.departmentId) ?? undefined)) throw forbidden();
  await checkEmployeeRefs(v, id);
  const data = {
    firstName: v.firstName, lastName: v.lastName, email: v.email, phone: nul(v.phone), dateOfBirth: v.dateOfBirth ? dateOnly(v.dateOfBirth) : null,
    gender: nul(v.gender) as never, category: v.category, employmentType: v.employmentType, departmentId: nul(v.departmentId), positionId: nul(v.positionId),
    designation: v.designation, reportingToId: nul(v.reportingToId), joinDate: dateOnly(v.joinDate), confirmationDate: v.confirmationDate ? dateOnly(v.confirmationDate) : null,
    specialization: nul(v.specialization), userId: nul(v.userId),
  };
  const e = await db.employee.update({ where: { id }, data });
  const changed = Object.keys(data).filter((k) => String((cur as Record<string, unknown>)[k] ?? "") !== String((data as Record<string, unknown>)[k] ?? ""));
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "hr.employee.update", resourceType: "employee", resourceId: id, summary: `${e.employeeNo}: ${changed.join(", ") || "no changes"}` });
  return e;
}

export async function setEmployeeStatus(ctx: AuthContext, id: string, raw: unknown) {
  const cur = await loadEmployeeFor(ctx, id, "hr.manage");
  const v = z.object({ status: z.enum(EmployeeStatus), exitDate: ymdString.nullable().optional().or(z.literal("")), reason: z.string().trim().min(5).max(500) }).parse(raw);
  const exiting = ["RESIGNED", "RETIRED", "TERMINATED"].includes(v.status);
  if (exiting && !v.exitDate) throw invalid("Enter the last working day.");
  const e = await db.employee.update({ where: { id }, data: { status: v.status, exitDate: exiting ? dateOnly(v.exitDate!) : null, exitReason: exiting ? v.reason : null } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "hr.employee.status", resourceType: "employee", resourceId: id, summary: `${cur.employeeNo}: ${cur.status} → ${v.status}`, newValue: { reason: v.reason } });
  return e;
}

/** Bank and tax identifiers are stored encrypted; only the last four characters are ever displayed. */
export async function setPayDetails(ctx: AuthContext, id: string, raw: unknown) {
  if (!can(ctx, "payroll.process") && !can(ctx, "hr.manage")) throw forbidden();
  const e = await loadEmployeeFor(ctx, id, "hr.manage").catch(async () => {
    if (!can(ctx, "payroll.process")) throw notFound("Employee");
    return db.employee.findUniqueOrThrow({ where: { id } });
  });
  const v = z.object({
    bankAccount: z.string().trim().regex(/^[0-9A-Z]{6,34}$/, "Enter the account number without spaces").nullable().optional().or(z.literal("")),
    bankIfsc: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,15}$/).nullable().optional().or(z.literal("")),
    taxId: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,20}$/).nullable().optional().or(z.literal("")),
  }).parse(raw);
  const data: Prisma.EmployeeUpdateInput = {};
  // Blank fields keep the stored value (the form never receives the plain values back).
  if (v.bankAccount) data.bankAccountEnc = encryptString(v.bankAccount);
  if (v.bankIfsc) data.bankIfsc = v.bankIfsc;
  if (v.taxId) data.taxIdEnc = encryptString(v.taxId);
  if (!Object.keys(data).length) throw invalid("Enter at least one value to update.");
  await db.employee.update({ where: { id }, data });
  // The values themselves are never written to the audit log.
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "hr.employee.paydetails", resourceType: "employee", resourceId: id, summary: `${e.employeeNo}: pay details updated (${Object.keys(data).join(", ")})` });
}

export function maskedPayDetails(e: { bankAccountEnc: string | null; bankIfsc: string | null; taxIdEnc: string | null }) {
  const dec = (s: string | null) => { try { return s ? decryptString(s) : null; } catch { return null; } };
  return { bankAccount: mask(dec(e.bankAccountEnc)), bankIfsc: e.bankIfsc ?? "—", taxId: mask(dec(e.taxIdEnc)) };
}

export const positionSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/),
  title: z.string().trim().min(2).max(120),
  category: z.enum(EmployeeCategory),
  departmentId: z.string().nullable().optional().or(z.literal("")),
  grade: z.string().trim().max(40).nullable().optional(),
  sanctioned: z.number().int().min(0).max(10000),
});

export async function savePosition(ctx: AuthContext, id: string | null, raw: unknown) {
  if (!can(ctx, "hr.manage")) throw forbidden();
  const v = positionSchema.parse(raw);
  const data = { ...v, departmentId: nul(v.departmentId), grade: nul(v.grade) };
  const p = id ? await db.position.update({ where: { id }, data }) : await db.position.create({ data });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: id ? "hr.position.update" : "hr.position.create", resourceType: "position", resourceId: p.id, summary: `${p.code} ${p.title}` });
  return p;
}

// ───────────────────────── Leave policy & balances ─────────────────────────

export const leaveTypeSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,10}$/),
  name: z.string().trim().min(2).max(80),
  annualQuota: z.number().min(0).max(365),
  carryForwardMax: z.number().min(0).max(365),
  paid: z.boolean(),
  allowHalfDay: z.boolean(),
  requiresDocument: z.boolean(),
  maxConsecutive: z.number().int().min(1).max(365).nullable().optional(),
  appliesTo: z.enum(EmployeeCategory).nullable().optional().or(z.literal("")),
  isActive: z.boolean(),
});

export async function saveLeaveType(ctx: AuthContext, id: string | null, raw: unknown) {
  if (!can(ctx, "hr.manage")) throw forbidden();
  const v = leaveTypeSchema.parse(raw);
  const data = { ...v, maxConsecutive: v.maxConsecutive ?? null, appliesTo: nul(v.appliesTo) as EmployeeCategory | null };
  const t = id ? await db.leaveType.update({ where: { id }, data }) : await db.leaveType.create({ data });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: id ? "hr.leavetype.update" : "hr.leavetype.create", resourceType: "leaveType", resourceId: t.id, summary: `${t.code} ${t.name}: ${t.annualQuota} day(s)` });
  return t;
}

/**
 * Open the year's leave balances for every active employee: the (pro-rated) quota of each applicable paid
 * leave type plus carry forward from last year. Existing balances are left untouched, so it is safe to re-run.
 */
export async function allocateLeaveBalances(ctx: AuthContext, year: number) {
  if (!can(ctx, "leave.manage")) throw forbidden();
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw invalid("Choose a valid year.");
  const [types, employees] = await Promise.all([
    db.leaveType.findMany({ where: { isActive: true, paid: true } }),
    db.employee.findMany({ where: { AND: [employeeWhere(ctx, "leave.manage"), { status: { in: ["ACTIVE", "ON_LEAVE"] } }] }, select: { id: true, category: true, joinDate: true } }),
  ]);
  const [existing, previous] = await Promise.all([
    db.leaveBalance.findMany({ where: { year, employeeId: { in: employees.map((e) => e.id) } }, select: { employeeId: true, leaveTypeId: true } }),
    db.leaveBalance.findMany({ where: { year: year - 1, employeeId: { in: employees.map((e) => e.id) } } }),
  ]);
  const has = new Set(existing.map((b) => `${b.employeeId}:${b.leaveTypeId}`));
  const prev = new Map(previous.map((b) => [`${b.employeeId}:${b.leaveTypeId}`, b]));
  const rows: Prisma.LeaveBalanceCreateManyInput[] = [];
  for (const e of employees) {
    for (const t of types) {
      if (t.appliesTo && t.appliesTo !== e.category) continue;
      const k = `${e.id}:${t.id}`;
      if (has.has(k)) continue;
      rows.push({ employeeId: e.id, leaveTypeId: t.id, year, entitled: proratedQuota(t.annualQuota, e.joinDate, year), carriedForward: carryForward(prev.get(k) ?? null, t.carryForwardMax) });
    }
  }
  if (rows.length) await db.leaveBalance.createMany({ data: rows });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "hr.leave.allocate", resourceType: "leaveBalance", resourceId: String(year), summary: `${rows.length} balance(s) opened for ${year}` });
  return { created: rows.length };
}

export async function adjustLeaveBalance(ctx: AuthContext, balanceId: string, raw: unknown) {
  const v = z.object({ entitled: z.number().min(0).max(365), reason: z.string().trim().min(5).max(300) }).parse(raw);
  const b = await db.leaveBalance.findUnique({ where: { id: balanceId }, include: { employee: true, leaveType: true } });
  if (!b) throw notFound("Leave balance");
  await loadEmployeeFor(ctx, b.employeeId, "leave.manage");
  if (v.entitled + b.carriedForward < b.used) throw invalid(`${b.used} day(s) are already used; the entitlement cannot be lower than that.`);
  await db.leaveBalance.update({ where: { id: balanceId }, data: { entitled: v.entitled } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "hr.leave.adjust", resourceType: "leaveBalance", resourceId: balanceId, summary: `${b.employee.employeeNo} ${b.leaveType.code} ${b.year}: ${b.entitled} → ${v.entitled}`, newValue: { reason: v.reason } });
}

// ───────────────────────── Leave applications ─────────────────────────

export const leaveApplySchema = z.object({
  leaveTypeId: z.string().min(1),
  fromDate: ymdString,
  toDate: ymdString,
  halfDay: z.enum(["FIRST_HALF", "SECOND_HALF"]).nullable().optional().or(z.literal("")),
  reason: z.string().trim().min(5).max(1000),
  contact: z.string().trim().max(120).nullable().optional(),
});

/** Apply for leave: for oneself, or on behalf of an employee in scope with leave.manage. */
export async function applyLeave(ctx: AuthContext, raw: unknown, onBehalfOf?: string) {
  const v = leaveApplySchema.parse(raw);
  const employeeId = onBehalfOf ?? ctx.subject.employeeId;
  if (!employeeId) throw forbidden("Your account is not linked to an employee record. Contact HR.");
  const emp = onBehalfOf ? await loadEmployeeFor(ctx, onBehalfOf, "leave.manage") : await db.employee.findUniqueOrThrow({ where: { id: employeeId } });
  if (!["ACTIVE", "ON_LEAVE"].includes(emp.status)) throw invalid("Leave can only be applied for active employees.");
  const type = await db.leaveType.findUnique({ where: { id: v.leaveTypeId } });
  if (!type || !type.isActive || (type.appliesTo && type.appliesTo !== emp.category)) throw invalid("This leave type is not available to this employee.");
  const from = dateOnly(v.fromDate);
  const to = dateOnly(v.toDate);
  if (to < from) throw invalid("The end date is before the start date.");
  if (from.getUTCFullYear() !== to.getUTCFullYear()) throw invalid("Apply separately for each calendar year.");
  const halfDay = nul(v.halfDay);
  if (halfDay && from.getTime() !== to.getTime()) throw invalid("A half day must start and end on the same date.");
  const cal = await workCalendar(from, to);
  const days = leaveDays(from, to, !!halfDay, cal);
  const [balance, overlapping] = await Promise.all([
    db.leaveBalance.findUnique({ where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: type.id, year: from.getUTCFullYear() } } }),
    db.leaveRequest.findMany({ where: { employeeId, status: { in: ["PENDING", "APPROVED"] }, fromDate: { lte: to }, toDate: { gte: from } }, select: { halfDay: true } }),
  ]);
  // Two different half days on the same date may both be taken.
  const clash = overlapping.some((o) => !halfDay || !o.halfDay || o.halfDay === halfDay);
  // Pending requests of the same type count against the balance too.
  const pending = type.paid ? await db.leaveRequest.aggregate({ where: { employeeId, leaveTypeId: type.id, status: "PENDING", fromDate: { gte: new Date(Date.UTC(from.getUTCFullYear(), 0, 1)), lte: new Date(Date.UTC(from.getUTCFullYear(), 11, 31)) } }, _sum: { days: true } }) : null;
  const effective = balance ? { ...balance, used: balance.used + (pending?._sum.days ?? 0) } : null;
  const check = checkLeave({ days, halfDay: !!halfDay, allowHalfDay: type.allowHalfDay, maxConsecutive: type.maxConsecutive, paid: type.paid, balance: effective, overlapsExisting: clash });
  if (!check.ok) throw invalid(check.reason!);

  // Approver routing data: the reporting manager's account, unless that is the applicant.
  const manager = emp.reportingToId ? await db.employee.findUnique({ where: { id: emp.reportingToId }, select: { userId: true, status: true } }) : null;
  const managerUserId = manager?.userId && manager.status === "ACTIVE" && manager.userId !== emp.userId ? manager.userId : null;
  const hodIsApplicant = !managerUserId && !!emp.userId && !!(await db.userRole.findFirst({ where: { userId: emp.userId, role: { key: "HOD" }, OR: [{ departmentId: emp.departmentId }, { departmentId: null }] } }));

  return db.$transaction(async (tx) => {
    const r = await tx.leaveRequest.create({ data: { employeeId, leaveTypeId: type.id, fromDate: from, toDate: to, halfDay: halfDay as never, days, reason: v.reason, contact: nul(v.contact) } });
    const data: LeaveData = {
      leaveRequestId: r.id, employeeId, employeeNo: emp.employeeNo, employeeName: `${emp.firstName} ${emp.lastName}`, leaveType: `${type.name} (${type.code})`,
      from: v.fromDate, to: v.toDate, halfDay: halfDay ?? null, days, reason: v.reason, managerUserId, hasManager: !!managerUserId, escalate: hodIsApplicant || !emp.departmentId,
    };
    await startWorkflow(tx, actorOf(ctx), {
      key: "hr.leave", resourceType: "leaveRequest", resourceId: r.id, title: `${type.name}: ${data.employeeName}, ${days} day(s)`, summary: v.reason,
      departmentId: emp.departmentId, subjectUserId: emp.userId, data: data as unknown as Record<string, unknown>,
    });
    return tx.leaveRequest.findUniqueOrThrow({ where: { id: r.id } });
  });
}

/** Withdraw a pending request, or cancel approved leave that has not started (balance restored). */
export async function cancelLeave(ctx: AuthContext, id: string, reason: string) {
  const r = await db.leaveRequest.findUnique({ where: { id }, include: { employee: true } });
  if (!r) throw notFound("Leave request");
  const own = r.employeeId === ctx.subject.employeeId;
  const manage = own ? false : !!(await db.employee.count({ where: { AND: [{ id: r.employeeId }, employeeWhere(ctx, "leave.manage")] } })) && can(ctx, "leave.manage");
  if (!own && !manage) throw notFound("Leave request");
  if (r.status === "PENDING" || r.status === "RETURNED") {
    const inst = await db.workflowInstance.findFirst({ where: { resourceType: "leaveRequest", resourceId: id, status: { in: ["IN_PROGRESS", "RETURNED"] } } });
    // The applicant (or whoever raised it) withdraws through the workflow; approvers reject instead.
    if (inst) await cancelWorkflow(ctx, inst.id, reason || "Withdrawn");
    else await db.leaveRequest.update({ where: { id }, data: { status: "CANCELLED", decidedAt: new Date() } });
    return;
  }
  if (r.status === "APPROVED") {
    const today = dateOnly(new Date().toISOString().slice(0, 10));
    if (r.fromDate <= today && !manage) throw workflowError("Leave that has started can only be cancelled by HR.");
    await db.$transaction((tx) => revokeApprovedLeave(tx, id, actorOf(ctx)));
    return;
  }
  throw workflowError(`This request is already ${r.status.toLowerCase()}.`);
}

/** Balances with availability for an employee and year. */
export async function leaveSummary(employeeId: string, year: number) {
  const [balances, types] = await Promise.all([
    db.leaveBalance.findMany({ where: { employeeId, year }, include: { leaveType: true }, orderBy: { leaveType: { code: "asc" } } }),
    db.leaveType.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
  ]);
  const pending = await db.leaveRequest.groupBy({ by: ["leaveTypeId"], where: { employeeId, status: "PENDING", fromDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } }, _sum: { days: true } });
  const pend = new Map(pending.map((p) => [p.leaveTypeId, p._sum.days ?? 0]));
  return {
    types,
    balances: balances.map((b) => ({ id: b.id, leaveTypeId: b.leaveTypeId, code: b.leaveType.code, name: b.leaveType.name, entitled: b.entitled, carriedForward: b.carriedForward, used: b.used, pending: pend.get(b.leaveTypeId) ?? 0, available: Math.max(0, available(b) - (pend.get(b.leaveTypeId) ?? 0)) })),
  };
}

// ───────────────────────── Staff attendance ─────────────────────────

export const staffAttendanceSchema = z.object({
  date: ymdString,
  entries: z.array(z.object({ employeeId: z.string().min(1), status: z.enum(StaffAttendanceStatus), remarks: z.string().trim().max(200).nullable().optional() })).min(1).max(2000),
});

/** Mark attendance for a day. Days covered by approved leave keep their leave mark. */
export async function markStaffAttendance(ctx: AuthContext, raw: unknown) {
  if (!can(ctx, "attendance.staff")) throw forbidden();
  const v = staffAttendanceSchema.parse(raw);
  const date = dateOnly(v.date);
  if (date.getTime() > Date.now()) throw invalid("Attendance cannot be marked for a future date.");
  const allowed = new Set((await db.employee.findMany({ where: { AND: [employeeWhere(ctx, "attendance.staff"), { id: { in: v.entries.map((e) => e.employeeId) } }] }, select: { id: true } })).map((e) => e.id));
  const onLeave = new Set((await db.staffAttendance.findMany({ where: { date, source: "LEAVE", employeeId: { in: [...allowed] } }, select: { employeeId: true } })).map((a) => a.employeeId));
  let saved = 0;
  let kept = 0;
  await db.$transaction(async (tx) => {
    for (const e of v.entries) {
      if (!allowed.has(e.employeeId)) throw forbidden("One or more employees are outside your scope.");
      if (onLeave.has(e.employeeId)) { kept++; continue; }
      await tx.staffAttendance.upsert({
        where: { employeeId_date: { employeeId: e.employeeId, date } },
        create: { employeeId: e.employeeId, date, status: e.status, remarks: nul(e.remarks), markedById: ctx.user.id },
        update: { status: e.status, remarks: nul(e.remarks), markedById: ctx.user.id, source: "MANUAL" },
      });
      saved++;
    }
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "hr.attendance.mark", resourceType: "staffAttendance", resourceId: v.date, summary: `${saved} marked, ${kept} on approved leave kept` }, tx);
  });
  return { saved, kept };
}

// ───────────────────────── Settings ─────────────────────────

/** HR and payroll settings are owned by HR (not only system administrators). */
export async function saveHrSettings(ctx: AuthContext, raw: unknown) {
  if (!can(ctx, "hr.manage") && !can(ctx, "payroll.process")) throw forbidden();
  const value = SETTING_SCHEMAS.hr.parse(raw);
  const slabs = value.tax.slabs;
  for (let i = 1; i < slabs.length; i++) {
    const prev = slabs[i - 1].upTo;
    const cur = slabs[i].upTo;
    if (prev === null || (cur !== null && cur <= prev)) throw invalid("Tax slabs must be in increasing order, with only the last one open-ended.");
  }
  if (slabs[slabs.length - 1].upTo !== null) throw invalid("The last tax slab must have no upper limit.");
  const before = await db.systemSetting.findUnique({ where: { key: "hr" } });
  await db.systemSetting.upsert({ where: { key: "hr" }, create: { key: "hr", value: value as Prisma.InputJsonValue, updatedById: ctx.user.id }, update: { value: value as Prisma.InputJsonValue, updatedById: ctx.user.id } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "settings.hr.update", resourceType: "settings", resourceId: "hr", oldValue: before?.value, newValue: value });
}
