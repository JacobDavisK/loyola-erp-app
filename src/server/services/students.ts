import "server-only";
import { reentryWindow } from "@/server/services/nep";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { Gender, GuardianRelation, StudentStatus } from "@/generated/prisma/enums";
import { assertStudentPerm, loadStudentFor, studentWhere } from "@/server/auth/access";
import { type AuthContext, can } from "@/server/auth/current";
import { db, type Tx } from "@/server/db";
import { conflict, forbidden, invalid, notFound } from "@/server/errors";
import { randomToken } from "@/server/security/crypto";
import { hashPassword } from "@/server/security/password";
import { sendInvite } from "@/server/services/admin";
import { audit } from "@/server/services/audit";
import { emitEvent } from "@/server/services/events";
import { nextNumber } from "@/server/services/sequence";
import { getSetting } from "@/server/services/settings";
import { startWorkflow } from "@/server/services/workflow";
import type { StudentStatusData } from "@/server/workflow/modules/student-status";

const opt = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => v || null);

export const addressSchema = z
  .object({ line1: opt(160), line2: opt(160), city: opt(80), state: opt(80), postalCode: opt(20), country: opt(80) })
  .nullable()
  .optional();

export const studentSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email(),
  phone: opt(30),
  dateOfBirth: z.coerce.date().nullable().optional(),
  gender: z.enum(Gender).nullable().optional(),
  nationality: opt(60),
  category: opt(40),
  bloodGroup: opt(8),
  programId: z.string().min(1, "Choose a programme"),
  batchId: z.string().min(1, "Choose a batch"),
  section: opt(10),
  specialization: opt(80),
  currentSemester: z.number().int().min(1).max(16).default(1),
  admissionNo: z.string().trim().max(30).nullable().optional(),
  registrationNo: z.string().trim().max(30).nullable().optional(),
  admittedOn: z.coerce.date(),
  address: addressSchema,
  emergencyName: opt(120),
  emergencyRelation: opt(40),
  emergencyPhone: opt(30),
});
export type StudentInput = z.input<typeof studentSchema>;

async function resolveProgram(tx: Tx | typeof db, programId: string, batchId: string) {
  const program = await tx.program.findFirst({ where: { id: programId, deletedAt: null }, include: { department: { select: { id: true, campusId: true } } } });
  if (!program) throw invalid("The programme does not exist.");
  const batch = await tx.batch.findFirst({ where: { id: batchId, deletedAt: null } });
  if (!batch || batch.programId !== program.id) throw invalid("The batch does not belong to the selected programme.");
  return { program, batch };
}

/** Student number from the configured template, e.g. "{YY}{PROGRAM}" + 4 digits → 26BCA0007. */
export async function allocateStudentNo(tx: Tx, programCode: string, admissionYear: number) {
  const { studentNumberPrefix, studentNumberPadding } = await getSetting("academic");
  const yy = String(admissionYear).slice(-2);
  const prefix = studentNumberPrefix.replaceAll("{YYYY}", String(admissionYear)).replaceAll("{YY}", yy).replaceAll("{PROGRAM}", programCode);
  return nextNumber(tx, `student.${prefix}`, { prefix, padding: studentNumberPadding });
}

function toData(v: z.infer<typeof studentSchema>) {
  const emergency = v.emergencyName || v.emergencyPhone ? { name: v.emergencyName, relation: v.emergencyRelation, phone: v.emergencyPhone } : null;
  return {
    firstName: v.firstName, lastName: v.lastName, email: v.email, phone: v.phone, dateOfBirth: v.dateOfBirth ?? null, gender: v.gender ?? null,
    nationality: v.nationality, category: v.category, bloodGroup: v.bloodGroup, section: v.section, specialization: v.specialization,
    currentSemester: v.currentSemester, registrationNo: v.registrationNo || null, admittedOn: v.admittedOn,
    address: (v.address ?? undefined) as Prisma.InputJsonValue | undefined,
    emergencyContact: (emergency ?? undefined) as Prisma.InputJsonValue | undefined,
  };
}

/** Create one student inside a transaction (shared by the form and the bulk import). */
export async function insertStudent(tx: Tx, actor: { id: string; name: string }, v: z.infer<typeof studentSchema>) {
  const { program, batch } = await resolveProgram(tx, v.programId, v.batchId);
  const studentNo = await allocateStudentNo(tx, program.code, batch.admissionYear);
  const admissionNo = v.admissionNo?.trim() || (await nextNumber(tx, `admission.${batch.admissionYear}`, { prefix: `ADM${batch.admissionYear}-`, padding: 5 }));
  if (await tx.student.findFirst({ where: { OR: [{ admissionNo }, ...(v.registrationNo ? [{ registrationNo: v.registrationNo }] : [])] } })) {
    throw conflict(`A student with admission number ${admissionNo}${v.registrationNo ? ` or registration number ${v.registrationNo}` : ""} already exists.`);
  }
  const student = await tx.student.create({
    data: { ...toData(v), studentNo, admissionNo, programId: program.id, batchId: batch.id, departmentId: program.departmentId, campusId: program.department.campusId },
  });
  await audit({ actorId: actor.id, actorName: actor.name, action: "student.create", resourceType: "student", resourceId: student.id, summary: `${studentNo} — ${v.firstName} ${v.lastName}`, newValue: { studentNo, admissionNo, program: program.code, batch: batch.code } }, tx);
  await emitEvent(tx, { type: "StudentAdmitted", aggregateType: "student", aggregateId: student.id, payload: { studentNo, programId: program.id, batchId: batch.id }, actorId: actor.id });
  return student;
}

export async function createStudent(ctx: AuthContext, raw: unknown) {
  const v = studentSchema.parse(raw);
  const program = await db.program.findUnique({ where: { id: v.programId }, select: { departmentId: true } });
  if (!program) throw invalid("The programme does not exist.");
  assertStudentPerm(ctx, "student.create", program.departmentId);
  return db.$transaction((tx) => insertStudent(tx, { id: ctx.user.id, name: ctx.user.name }, v));
}

const AUDITED_FIELDS = ["firstName", "lastName", "email", "phone", "dateOfBirth", "gender", "nationality", "category", "section", "specialization", "currentSemester", "registrationNo", "programId", "batchId"] as const;

export async function updateStudent(ctx: AuthContext, id: string, raw: unknown) {
  const before = await loadStudentFor(ctx, id);
  assertStudentPerm(ctx, "student.update", before.departmentId);
  const v = studentSchema.parse(raw);
  const { program, batch } = await resolveProgram(db, v.programId, v.batchId);
  if (program.departmentId !== before.departmentId) assertStudentPerm(ctx, "student.update", program.departmentId);
  if (v.registrationNo && (await db.student.findFirst({ where: { registrationNo: v.registrationNo, id: { not: id } } }))) throw conflict("Another student has this registration number.");
  const data = { ...toData(v), programId: program.id, batchId: batch.id, departmentId: program.departmentId, campusId: program.department.campusId };
  const changed = AUDITED_FIELDS.filter((k) => String(before[k] ?? "") !== String((data as Record<string, unknown>)[k] ?? ""));
  return db.$transaction(async (tx) => {
    const s = await tx.student.update({ where: { id }, data });
    await audit(
      {
        actorId: ctx.user.id, actorName: ctx.user.name, action: "student.update", resourceType: "student", resourceId: id,
        summary: `${before.studentNo}: ${changed.length ? changed.join(", ") : "contact/address details"} updated`,
        oldValue: Object.fromEntries(changed.map((k) => [k, before[k]])), newValue: Object.fromEntries(changed.map((k) => [k, (data as Record<string, unknown>)[k]])),
      },
      tx,
    );
    if (s.userId && before.email !== s.email) await tx.user.update({ where: { id: s.userId }, data: { email: s.email } }).catch(() => { throw conflict("That e-mail is already used by another account."); });
    return s;
  });
}

const statusSchema = z.object({
  to: z.enum(StudentStatus),
  reason: z.string().trim().min(10, "Give the reason (at least 10 characters)").max(1000),
  effectiveOn: z.coerce.date(),
});

/** Status changes always go through the approval workflow and are applied on approval. */
export async function requestStatusChange(ctx: AuthContext, id: string, raw: unknown) {
  const s = await loadStudentFor(ctx, id);
  assertStudentPerm(ctx, "student.status", s.departmentId);
  const v = statusSchema.parse(raw);
  if (v.to === s.status) throw invalid("The student already has this status.");
  if (v.to === "EXITED") throw invalid("Exits with an award are requested from the student's NEP tab.");
  if (s.status === "EXITED" && v.to === "ACTIVE") {
    const until = await reentryWindow(s.id);
    if (!until || until < new Date()) throw invalid("The re-entry window for this student's exit award has closed.");
  }
  const program = await db.program.findUniqueOrThrow({ where: { id: s.programId }, select: { code: true } });
  const data: StudentStatusData = {
    studentId: s.id, studentNo: s.studentNo, studentName: `${s.firstName} ${s.lastName}`, from: s.status, to: v.to, reason: v.reason,
    effectiveOn: v.effectiveOn.toISOString(), programCode: program.code,
  };
  return db.$transaction((tx) =>
    startWorkflow(tx, { id: ctx.user.id, name: ctx.user.name }, {
      key: "student.status_change",
      resourceType: "student",
      resourceId: s.id,
      title: `${data.studentName} (${s.studentNo}): ${s.status.toLowerCase().replace("_", " ")} → ${v.to.toLowerCase().replace("_", " ")}`,
      summary: v.reason,
      departmentId: s.departmentId,
      subjectUserId: s.userId,
      data: data as unknown as Record<string, unknown>,
    }),
  );
}

// ───────────────────────── Guardians ─────────────────────────

export const guardianSchema = z.object({
  name: z.string().trim().min(2).max(120),
  relation: z.enum(GuardianRelation),
  phone: opt(30),
  email: z.string().trim().toLowerCase().email().nullable().optional().or(z.literal("").transform(() => null)),
  occupation: opt(80),
  isPrimary: z.boolean().default(false),
  canViewAcademic: z.boolean().default(true),
  canViewFinance: z.boolean().default(true),
});

export async function saveGuardian(ctx: AuthContext, studentId: string, guardianId: string | null, raw: unknown) {
  const s = await loadStudentFor(ctx, studentId);
  assertStudentPerm(ctx, "student.update", s.departmentId);
  const v = guardianSchema.parse(raw);
  return db.$transaction(async (tx) => {
    if (v.isPrimary) await tx.guardian.updateMany({ where: { studentId, ...(guardianId ? { id: { not: guardianId } } : {}) }, data: { isPrimary: false } });
    const before = guardianId ? await tx.guardian.findFirst({ where: { id: guardianId, studentId } }) : null;
    if (guardianId && !before) throw notFound("Guardian");
    const g = guardianId ? await tx.guardian.update({ where: { id: guardianId }, data: v }) : await tx.guardian.create({ data: { ...v, studentId } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: guardianId ? "guardian.update" : "guardian.create", resourceType: "student", resourceId: studentId, summary: `${v.name} (${v.relation.toLowerCase()})`, oldValue: before ?? undefined, newValue: v }, tx);
    return g;
  });
}

export async function removeGuardian(ctx: AuthContext, studentId: string, guardianId: string) {
  const s = await loadStudentFor(ctx, studentId);
  assertStudentPerm(ctx, "student.update", s.departmentId);
  const g = await db.guardian.findFirst({ where: { id: guardianId, studentId } });
  if (!g) throw notFound("Guardian");
  await db.$transaction(async (tx) => {
    await tx.guardian.delete({ where: { id: guardianId } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "guardian.remove", resourceType: "student", resourceId: studentId, summary: g.name, oldValue: g }, tx);
  });
}

// ───────────────────────── Portal accounts ─────────────────────────

async function roleIdOf(key: string) {
  const r = await db.role.findUnique({ where: { key } });
  if (!r) throw invalid(`The ${key} role is missing. Run npm run rbac:sync.`);
  return r.id;
}

/**
 * Create the self-service account for a student (or a guardian). The person receives an invitation
 * to set their own password; staff never see or set it. The sign-in ID is the student number.
 */
export async function provisionStudentAccount(ctx: AuthContext, studentId: string) {
  const s = await loadStudentFor(ctx, studentId);
  assertStudentPerm(ctx, "student.update", s.departmentId);
  if (s.userId) throw conflict("This student already has a portal account.");
  if (s.status !== "ACTIVE" && s.status !== "ON_LEAVE") throw invalid("Portal accounts are created only for active students.");
  if (await db.user.findFirst({ where: { OR: [{ email: s.email }, { employeeId: s.studentNo }] } })) throw conflict("The student's e-mail is already used by another account. Update the e-mail first.");
  const roleId = await roleIdOf("STUDENT");
  const user = await db.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        name: `${s.firstName} ${s.lastName}`, email: s.email, employeeId: s.studentNo, phone: s.phone, userType: "STUDENT", departmentId: s.departmentId,
        mustChangePassword: true, passwordHash: await hashPassword(randomToken(24)), roles: { create: [{ roleId, grantedById: ctx.user.id }] },
      },
    });
    await tx.student.update({ where: { id: s.id }, data: { userId: u.id } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "student.account.create", resourceType: "student", resourceId: s.id, summary: `Portal account for ${s.studentNo}` }, tx);
    return u;
  });
  await sendInvite(user.id, user.email, user.name);
  return user;
}

export async function provisionGuardianAccount(ctx: AuthContext, studentId: string, guardianId: string) {
  const s = await loadStudentFor(ctx, studentId);
  assertStudentPerm(ctx, "student.update", s.departmentId);
  const g = await db.guardian.findFirst({ where: { id: guardianId, studentId } });
  if (!g) throw notFound("Guardian");
  if (g.userId) throw conflict("This guardian already has a portal account.");
  if (!g.email) throw invalid("Add the guardian's e-mail address first.");
  const existing = await db.user.findUnique({ where: { email: g.email } });
  if (existing && existing.userType !== "GUARDIAN") throw conflict("That e-mail belongs to a staff or student account.");
  const roleId = await roleIdOf("GUARDIAN");
  const user = await db.$transaction(async (tx) => {
    // A guardian with several children at the institution has one account linked to each ward.
    const u =
      existing ??
      (await tx.user.create({
        data: {
          name: g.name, email: g.email!, employeeId: await nextNumber(tx, "guardian.login", { prefix: "G", padding: 6 }), phone: g.phone, userType: "GUARDIAN",
          mustChangePassword: true, passwordHash: await hashPassword(randomToken(24)), roles: { create: [{ roleId, grantedById: ctx.user.id }] },
        },
      }));
    await tx.guardian.update({ where: { id: g.id }, data: { userId: u.id } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "guardian.account.link", resourceType: "student", resourceId: s.id, summary: `${existing ? "Linked existing" : "Created"} guardian account for ${g.name}` }, tx);
    return { user: u, created: !existing };
  });
  if (user.created) await sendInvite(user.user.id, user.user.email, user.user.name);
  return user.user;
}

// ───────────────────────── Queries & export ─────────────────────────

export interface StudentFilters {
  q?: string;
  programId?: string;
  batchId?: string;
  departmentId?: string;
  status?: string;
  semester?: string;
  section?: string;
}

export function studentFilterWhere(ctx: AuthContext, f: StudentFilters): Prisma.StudentWhereInput {
  const and: Prisma.StudentWhereInput[] = [studentWhere(ctx)];
  if (f.programId) and.push({ programId: f.programId });
  if (f.batchId) and.push({ batchId: f.batchId });
  if (f.departmentId) and.push({ departmentId: f.departmentId });
  if (f.status && f.status in StudentStatus) and.push({ status: f.status as StudentStatus });
  if (f.semester && Number(f.semester)) and.push({ currentSemester: Number(f.semester) });
  if (f.section) and.push({ section: f.section });
  const q = f.q?.trim().slice(0, 80);
  if (q) {
    const words = q.split(/\s+/).slice(0, 4);
    and.push({
      AND: words.map((w) => ({
        OR: [
          { firstName: { contains: w, mode: "insensitive" as const } }, { lastName: { contains: w, mode: "insensitive" as const } },
          { studentNo: { contains: w, mode: "insensitive" as const } }, { admissionNo: { contains: w, mode: "insensitive" as const } },
          { registrationNo: { contains: w, mode: "insensitive" as const } }, { email: { contains: w, mode: "insensitive" as const } },
        ],
      })),
    });
  }
  return { AND: and };
}

export const STUDENT_SORTS = {
  name: [{ lastName: "asc" }, { firstName: "asc" }],
  "-name": [{ lastName: "desc" }, { firstName: "desc" }],
  studentNo: [{ studentNo: "asc" }],
  "-studentNo": [{ studentNo: "desc" }],
  admitted: [{ admittedOn: "asc" }],
  "-admitted": [{ admittedOn: "desc" }],
  semester: [{ currentSemester: "asc" }, { studentNo: "asc" }],
  "-semester": [{ currentSemester: "desc" }, { studentNo: "asc" }],
} as const satisfies Record<string, Prisma.StudentOrderByWithRelationInput[]>;

/** Full filtered export (not just the visible page). Audited; requires student.export. */
export async function exportStudents(ctx: AuthContext, f: StudentFilters) {
  if (!can(ctx, "student.export")) throw forbidden();
  const where = studentFilterWhere(ctx, f);
  const rows = await db.student.findMany({
    where,
    orderBy: [{ studentNo: "asc" }],
    take: 50_000,
    include: { program: { select: { code: true } }, batch: { select: { code: true } }, department: { select: { code: true } } },
  });
  // Rows outside the caller's export scope are dropped (student.view may be wider than student.export).
  const allowed = rows.filter((s) => can(ctx, "student.export", s.departmentId));
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "student.export", resourceType: "student", summary: `${allowed.length} student record(s) exported`, metadata: { filters: f } });
  return allowed;
}
