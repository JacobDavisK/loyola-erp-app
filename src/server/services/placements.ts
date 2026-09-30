import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { checkDriveEligibility, driveEligibilitySchema, type PlacementFacts } from "@/lib/domain/campus";
import { toMinor } from "@/lib/domain/money";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { currentCgpa } from "@/server/services/academic-record";
import { audit } from "@/server/services/audit";
import { notify } from "@/server/services/notifications";
import { getSetting } from "@/server/services/settings";

/**
 * Placements: companies, recruitment drives with rule-based eligibility (CGPA, programme, backlogs, batch,
 * one-offer policy) checked against academic records, student applications and selections. Alumni keep a
 * profile (employer, higher studies) and may opt into the alumni directory.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });
const needManage = (ctx: AuthContext) => {
  if (!can(ctx, "placement.manage")) throw forbidden();
};

export async function saveCompany(ctx: AuthContext, id: string | null, raw: unknown) {
  needManage(ctx);
  const v = z.object({ name: z.string().trim().min(2).max(160), industry: z.string().trim().max(80).nullable().optional(), website: z.string().trim().url().max(200).nullable().optional().or(z.literal("")), contactName: z.string().trim().max(120).nullable().optional(), contactEmail: z.string().trim().email().nullable().optional().or(z.literal("")) }).parse(raw);
  const data = { name: v.name, industry: v.industry || null, website: v.website || null, contactName: v.contactName || null, contactEmail: v.contactEmail || null };
  const c = id ? await db.company.update({ where: { id }, data }) : await db.company.create({ data });
  await audit({ ...actor(ctx), action: id ? "placement.company.update" : "placement.company.create", resourceType: "company", resourceId: c.id, summary: c.name });
  return c;
}

export const driveSchema = z.object({
  companyId: z.string().min(1),
  title: z.string().trim().min(3).max(200),
  role: z.string().trim().min(2).max(120),
  description: z.string().trim().min(10).max(10_000),
  location: z.string().trim().max(120).nullable().optional(),
  ctc: z.number().min(0).max(1_000_000_000),
  applyBy: z.coerce.date(),
  driveDate: z.coerce.date().nullable().optional(),
  status: z.enum(["DRAFT", "OPEN", "CLOSED", "COMPLETED"]),
  eligibility: driveEligibilitySchema,
});

export async function saveDrive(ctx: AuthContext, id: string | null, raw: unknown) {
  needManage(ctx);
  const v = driveSchema.parse(raw);
  const prev = id ? await db.placementDrive.findUnique({ where: { id } }) : null;
  if (id && !prev) throw notFound("Drive");
  const data = { ...v, location: v.location || null, driveDate: v.driveDate ?? null, ctc: v.ctc.toFixed(2), eligibility: v.eligibility as Prisma.InputJsonValue };
  const d = id ? await db.placementDrive.update({ where: { id }, data }) : await db.placementDrive.create({ data: { ...data, createdById: ctx.user.id } });
  if (v.status === "OPEN" && prev?.status !== "OPEN") {
    // Tell eligible final-year students (and anyone whose programme is listed) that the drive is open.
    const e = v.eligibility;
    const students = await db.student.findMany({ where: { status: "ACTIVE", deletedAt: null, userId: { not: null }, ...(e.programCodes?.length ? { program: { code: { in: e.programCodes } } } : {}), ...(e.batchYears?.length ? { batch: { admissionYear: { in: e.batchYears } } } : {}) }, select: { userId: true } });
    const company = await db.company.findUniqueOrThrow({ where: { id: v.companyId } });
    await notify({ userIds: students.map((s) => s.userId), type: "placement.drive", title: `Placement drive open: ${company.name} — ${v.role}`, body: `Apply by ${v.applyBy.toISOString().slice(0, 10)}`, link: `/portal/placements`, email: false });
  }
  await audit({ ...actor(ctx), action: id ? "placement.drive.update" : "placement.drive.create", resourceType: "placementDrive", resourceId: d.id, summary: `${d.title} (${d.status})` });
  return d;
}

export async function placementFacts(studentId: string): Promise<PlacementFacts> {
  const s = await db.student.findUniqueOrThrow({ where: { id: studentId }, include: { program: { select: { code: true } }, batch: { select: { admissionYear: true } } } });
  const [cgpa, failed, placed] = await Promise.all([
    currentCgpa(studentId),
    db.courseResult.findMany({ where: { studentId, isCurrent: true, publishedAt: { not: null }, status: { in: ["FAIL", "ABSENT"] } }, select: { courseId: true } }),
    db.placementApplication.count({ where: { studentId, status: "SELECTED" } }),
  ]);
  // A backlog is active until a later current result for the course is a pass.
  const cleared = failed.length ? await db.courseResult.findMany({ where: { studentId, isCurrent: true, publishedAt: { not: null }, status: "PASS", courseId: { in: failed.map((f) => f.courseId) } }, select: { courseId: true } }) : [];
  const active = new Set(failed.map((f) => f.courseId).filter((c) => !cleared.some((x) => x.courseId === c)));
  return { cgpa, programCode: s.program.code, activeBacklogs: active.size, admissionYear: s.batch.admissionYear, placedCount: placed };
}

export async function eligibilityFor(studentId: string, drive: { eligibility: unknown }) {
  const [facts, { oneOfferPolicy }] = await Promise.all([placementFacts(studentId), getSetting("placements")]);
  return { facts, ...checkDriveEligibility(driveEligibilitySchema.parse(drive.eligibility), facts, oneOfferPolicy) };
}

export async function applyToDrive(ctx: AuthContext, driveId: string) {
  const studentId = ctx.subject.studentId;
  if (!studentId) throw forbidden("Only students apply to drives.");
  const d = await db.placementDrive.findUnique({ where: { id: driveId } });
  if (!d || d.status !== "OPEN") throw notFound("Drive");
  if (d.applyBy < new Date()) throw workflowError("Applications for this drive have closed.");
  const e = await eligibilityFor(studentId, d);
  if (!e.eligible) throw workflowError(`Not eligible: ${e.reasons.join("; ")}.`);
  const existing = await db.placementApplication.findUnique({ where: { driveId_studentId: { driveId, studentId } } });
  if (existing && existing.status !== "WITHDRAWN") throw conflict("You have already applied to this drive.");
  const a = existing
    ? await db.placementApplication.update({ where: { id: existing.id }, data: { status: "APPLIED", snapshot: e.facts as unknown as Prisma.InputJsonValue } })
    : await db.placementApplication.create({ data: { driveId, studentId, snapshot: e.facts as unknown as Prisma.InputJsonValue } });
  await audit({ ...actor(ctx), action: "placement.apply", resourceType: "placementDrive", resourceId: driveId, summary: d.title });
  return a;
}

export async function withdrawApplication(ctx: AuthContext, id: string) {
  const a = await db.placementApplication.findUnique({ where: { id } });
  if (!a || a.studentId !== ctx.subject.studentId) throw notFound("Application");
  if (a.status !== "APPLIED" && a.status !== "SHORTLISTED") throw workflowError("This application can no longer be withdrawn.");
  await db.placementApplication.update({ where: { id }, data: { status: "WITHDRAWN" } });
}

export async function updateApplication(ctx: AuthContext, id: string, raw: unknown) {
  needManage(ctx);
  const v = z.object({ status: z.enum(["SHORTLISTED", "SELECTED", "REJECTED"]), offerCtc: z.number().min(0).max(1_000_000_000).nullable().optional() }).parse(raw);
  const a = await db.placementApplication.findUnique({ where: { id }, include: { drive: { include: { company: true } }, student: { select: { userId: true, studentNo: true } } } });
  if (!a) throw notFound("Application");
  if (a.status === "WITHDRAWN") throw workflowError("The student withdrew this application.");
  const offer = v.status === "SELECTED" ? (v.offerCtc ?? Number(a.drive.ctc)) : null;
  await db.placementApplication.update({ where: { id }, data: { status: v.status, offerCtc: offer !== null ? offer.toFixed(2) : null, updatedById: ctx.user.id } });
  if (a.student.userId && v.status !== "REJECTED") await notify({ userIds: [a.student.userId], type: "placement.update", title: v.status === "SELECTED" ? `Selected by ${a.drive.company.name}!` : `Shortlisted: ${a.drive.company.name}`, link: "/portal/placements" });
  await audit({ ...actor(ctx), action: "placement.status", resourceType: "placementApplication", resourceId: id, summary: `${a.student.studentNo} ${a.drive.company.name}: ${v.status}${offer ? ` (${offer})` : ""}` });
}

export async function placementStats(batchYear?: number) {
  const where: Prisma.PlacementApplicationWhereInput = { status: "SELECTED", ...(batchYear ? { student: { batch: { admissionYear: batchYear } } } : {}) };
  const selected = await db.placementApplication.findMany({ where, select: { studentId: true, offerCtc: true } });
  const ctcs = selected.map((s) => toMinor(s.offerCtc) / 100).sort((a, b) => a - b);
  const median = ctcs.length ? (ctcs.length % 2 ? ctcs[(ctcs.length - 1) / 2] : (ctcs[ctcs.length / 2 - 1] + ctcs[ctcs.length / 2]) / 2) : null;
  return { offers: selected.length, placedStudents: new Set(selected.map((s) => s.studentId)).size, highest: ctcs.at(-1) ?? null, median };
}

// ───────────────────────── Alumni ─────────────────────────

export const alumniSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().max(30).nullable().optional(),
  employer: z.string().trim().max(160).nullable().optional(),
  designation: z.string().trim().max(120).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  higherStudies: z.string().trim().max(200).nullable().optional(),
  linkedin: z.string().trim().url().max(200).nullable().optional().or(z.literal("")),
  inDirectory: z.boolean().default(false),
});

/** Graduates keep their portal account and maintain their own alumni profile. */
export async function saveMyAlumniProfile(ctx: AuthContext, raw: unknown) {
  const studentId = ctx.subject.studentId;
  if (!studentId) throw forbidden();
  const s = await db.student.findUniqueOrThrow({ where: { id: studentId } });
  if (s.status !== "GRADUATED") throw workflowError("The alumni profile opens after graduation.");
  const v = alumniSchema.parse(raw);
  const data = { ...v, phone: v.phone || null, employer: v.employer || null, designation: v.designation || null, city: v.city || null, higherStudies: v.higherStudies || null, linkedin: v.linkedin || null };
  await db.alumniProfile.upsert({ where: { studentId }, create: { ...data, studentId }, update: data });
  await audit({ ...actor(ctx), action: "alumni.profile", resourceType: "student", resourceId: studentId, summary: `directory ${v.inDirectory ? "on" : "off"}` });
}

/** Staff with alumni.view see all profiles; graduates see only those who opted into the directory. */
export function alumniWhere(ctx: AuthContext): Prisma.AlumniProfileWhereInput {
  return can(ctx, "alumni.view") ? {} : { inDirectory: true };
}

export async function invalidIfNotGraduate(ctx: AuthContext) {
  if (can(ctx, "alumni.view")) return;
  const id = ctx.subject.studentId;
  const s = id ? await db.student.findUnique({ where: { id }, select: { status: true } }) : null;
  if (s?.status !== "GRADUATED") throw invalid("The alumni directory is open to graduates.");
}
