import "server-only";
import { z } from "zod";
import type { NadBatchKind, NadBatchStatus, Prisma } from "@/generated/prisma/client";
import { normaliseApaar } from "@/lib/domain/compliance";
import { type AuthContext, can } from "@/server/auth/current";
import { assertStudentPerm, loadStudentFor } from "@/server/auth/access";
import { db } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { nextNumber } from "@/server/services/sequence";
import { getSetting } from "@/server/services/settings";

/**
 * APAAR IDs, the Academic Bank of Credits (ABC) and the National Academic Depository (NAD-DigiLocker).
 *
 * The ABC and NAD portals accept bulk uploads from registered institutions. This module keeps each
 * student's APAAR ID (entered by the student or the office, then verified against the APAAR card) and
 * prepares upload files from published results and issued certificates. Every batch freezes its rows,
 * so the file uploaded is the file that was reviewed; the office records the portal's acknowledgement.
 * Direct API submission needs the institution's ABC/NAD credentials and can be added behind `rows`.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });

export async function setApaarId(ctx: AuthContext, studentId: string, raw: string | null) {
  const s = await loadStudentFor(ctx, studentId);
  const self = ctx.subject.studentId === studentId;
  if (!self) assertStudentPerm(ctx, "student.update", s.departmentId);
  const id = raw ? normaliseApaar(raw) : null;
  if (raw && !id) throw invalid("An APAAR ID has 12 digits.");
  if (s.apaarVerifiedAt && !can(ctx, "apaar.manage")) throw workflowError("Your APAAR ID is verified. Ask the office to change it.");
  if (id && (await db.student.findFirst({ where: { apaarId: id, id: { not: studentId } } }))) throw conflict("Another student record already has this APAAR ID.");
  await db.student.update({ where: { id: studentId }, data: { apaarId: id, apaarVerifiedAt: null, apaarVerifiedById: null } });
  await audit({ ...actor(ctx), action: "student.apaar", resourceType: "student", resourceId: studentId, summary: `${s.studentNo}: APAAR ID ${id ? "recorded" : "removed"}`, oldValue: { apaarId: s.apaarId }, newValue: { apaarId: id } });
}

export async function verifyApaarId(ctx: AuthContext, studentId: string, verified: boolean) {
  if (!can(ctx, "apaar.manage")) throw forbidden();
  const s = await loadStudentFor(ctx, studentId);
  if (!s.apaarId) throw invalid("The student has no APAAR ID yet.");
  await db.student.update({ where: { id: studentId }, data: verified ? { apaarVerifiedAt: new Date(), apaarVerifiedById: ctx.user.id } : { apaarVerifiedAt: null, apaarVerifiedById: null } });
  await audit({ ...actor(ctx), action: verified ? "student.apaar.verify" : "student.apaar.unverify", resourceType: "student", resourceId: studentId, summary: `${s.studentNo}: APAAR ID ${verified ? "verified" : "verification withdrawn"}` });
}

/** Coverage figures for the compliance dashboard. */
export async function apaarCoverage() {
  const active = { deletedAt: null, status: { in: ["ACTIVE", "ON_LEAVE", "GRADUATED", "EXITED"] as ("ACTIVE" | "ON_LEAVE" | "GRADUATED" | "EXITED")[] } };
  const [total, withId, verified] = await Promise.all([
    db.student.count({ where: active }),
    db.student.count({ where: { ...active, apaarId: { not: null } } }),
    db.student.count({ where: { ...active, apaarVerifiedAt: { not: null } } }),
  ]);
  return { total, withId, verified, awaitingVerification: withId - verified, missing: total - withId };
}

// ───────────────────────── Upload batches ─────────────────────────

const fmtDob = (d: Date | null) => (d ? `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}` : "");
const GENDER: Record<string, string> = { FEMALE: "F", MALE: "M", OTHER: "T" };
type Row = Record<string, string | number | null>;

const studentSelect = { id: true, studentNo: true, registrationNo: true, firstName: true, lastName: true, gender: true, dateOfBirth: true, apaarId: true, apaarVerifiedAt: true, program: { select: { code: true, name: true } } } as const;
type BatchStudent = Prisma.StudentGetPayload<{ select: typeof studentSelect }>;

function identity(s: BatchStudent, org: string): Row {
  return {
    ORG_NAME: org, ACADEMIC_COURSE_ID: s.program.code, COURSE_NAME: s.program.name, REGN_NO: s.registrationNo ?? s.studentNo, RROLL: s.studentNo,
    CNAME: `${s.firstName} ${s.lastName}`.toUpperCase(), GENDER: s.gender ? GENDER[s.gender] : "", DOB: fmtDob(s.dateOfBirth), ABC_ACCOUNT_ID: s.apaarId,
  };
}

const skip = (s: BatchStudent, reason: string) => ({ studentId: s.id, studentNo: s.studentNo, name: `${s.firstName} ${s.lastName}`, reason });
const apaarProblem = (s: BatchStudent) => (!s.apaarId ? "No APAAR ID" : !s.apaarVerifiedAt ? "APAAR ID not verified" : null);

async function abcCreditRows(termId: string, org: string) {
  const results = await db.courseResult.findMany({
    where: { termId, isCurrent: true, publishedAt: { not: null }, status: "PASS" },
    include: { student: { select: studentSelect }, course: { select: { code: true, title: true } }, run: { select: { term: { select: { name: true, startDate: true } } } } },
    orderBy: [{ student: { studentNo: "asc" } }, { course: { code: "asc" } }],
  });
  const rows: Row[] = [];
  const skipped = new Map<string, ReturnType<typeof skip>>();
  for (const r of results) {
    const p = apaarProblem(r.student);
    if (p) { skipped.set(r.studentId, skip(r.student, p)); continue; }
    const t = r.run.term;
    rows.push({
      ABC_ACCOUNT_ID: r.student.apaarId, CNAME: `${r.student.firstName} ${r.student.lastName}`.toUpperCase(), GENDER: r.student.gender ? GENDER[r.student.gender] : "", DOB: fmtDob(r.student.dateOfBirth),
      ORG_NAME: org, ACADEMIC_COURSE_ID: r.student.program.code, COURSE_NAME: r.student.program.name, RROLL: r.student.studentNo, REGN_NO: r.student.registrationNo ?? r.student.studentNo,
      SUBJECT_CODE: r.course.code, SUBJECT_NAME: r.course.title, CREDIT: r.credits, GRADE: r.grade, GRADE_POINT: r.gradePoint, TERM: t.name, YEAR: t.startDate.getUTCFullYear(),
      RESULT_DATE: r.publishedAt ? r.publishedAt.toISOString().slice(0, 10) : "",
    });
  }
  return { rows, skipped: [...skipped.values()] };
}

async function nadMarksheetRows(termId: string, org: string) {
  const terms = await db.termResult.findMany({
    where: { termId, isCurrent: true, publishedAt: { not: null } },
    include: { student: { select: studentSelect }, run: { select: { term: { select: { name: true, startDate: true } } } } },
    orderBy: { student: { studentNo: "asc" } },
  });
  const courses = await db.courseResult.findMany({ where: { termId, isCurrent: true, publishedAt: { not: null }, studentId: { in: terms.map((t) => t.studentId) } }, include: { course: { select: { code: true, title: true } } }, orderBy: { course: { code: "asc" } } });
  const marksheets = await db.issuedCredential.findMany({ where: { type: "MARKSHEET", status: "ISSUED", studentId: { in: terms.map((t) => t.studentId) } }, select: { studentId: true, serialNo: true, issuedAt: true, payload: true } });
  const rows: Row[] = [];
  const skipped: ReturnType<typeof skip>[] = [];
  for (const t of terms) {
    const p = apaarProblem(t.student);
    if (p) { skipped.push(skip(t.student, p)); continue; }
    const termName = t.run.term.name;
    const cert = marksheets.find((m) => m.studentId === t.studentId && (m.payload as { terms?: { term: string }[] }).terms?.[0]?.term === termName);
    const row: Row = {
      ...identity(t.student, org), SESSION: termName, SEM: termName, RESULT: t.status === "PASS" ? "PASS" : t.status === "WITHHELD" ? "WITHHELD" : "FAIL",
      SGPA: t.sgpa, CGPA: t.cgpa, TOT_CREDIT: t.creditsEarned, TOT_CREDIT_POINTS: t.creditPoints, YEAR: t.run.term.startDate.getUTCFullYear(),
      MONTH: t.publishedAt ? t.publishedAt.toLocaleString("en-GB", { month: "short", timeZone: "UTC" }).toUpperCase() : "", DOI: t.publishedAt ? fmtDob(t.publishedAt) : "",
      CERT_NO: cert?.serialNo ?? "",
    };
    courses.filter((c) => c.studentId === t.studentId).forEach((c, i) => {
      const n = i + 1;
      row[`SUB${n}NM`] = c.course.title;
      row[`SUB${n}`] = c.course.code;
      row[`SUB${n}_TOT`] = c.totalMarks;
      row[`SUB${n}_MAX`] = c.maxMarks;
      row[`SUB${n}_GRADE`] = c.grade;
      row[`SUB${n}_GRADE_POINTS`] = c.gradePoint;
      row[`SUB${n}_CREDIT`] = c.credits;
    });
    rows.push(row);
  }
  return { rows, skipped };
}

async function nadDegreeRows(org: string) {
  // Degree certificates not already sent in a batch that the portal accepted or is still processing.
  const earlier = await db.nadBatch.findMany({ where: { kind: "NAD_DEGREE", status: { not: "REJECTED" } }, select: { rows: true } });
  const sent = new Set(earlier.flatMap((b) => (b.rows as Row[]).map((r) => String(r.CERT_NO))));
  const certs = await db.issuedCredential.findMany({ where: { type: "DEGREE_CERTIFICATE", status: "ISSUED" }, include: { student: { select: studentSelect } }, orderBy: { issuedAt: "asc" } });
  const rows: Row[] = [];
  const skipped: ReturnType<typeof skip>[] = [];
  for (const c of certs) {
    if (sent.has(c.serialNo)) continue;
    const p = apaarProblem(c.student);
    if (p) { skipped.push(skip(c.student, p)); continue; }
    const pl = c.payload as { cgpa?: number | null; creditsEarned?: number | null };
    rows.push({ ...identity(c.student, org), CGPA: pl.cgpa ?? null, TOT_CREDIT: pl.creditsEarned ?? null, YEAR: c.issuedAt.getUTCFullYear(), DOI: fmtDob(c.issuedAt), CERT_NO: c.serialNo, VERIFICATION_CODE: c.verificationCode });
  }
  return { rows, skipped };
}

export const NAD_KIND_LABEL: Record<NadBatchKind, string> = {
  ABC_CREDITS: "Academic Bank of Credits — credits earned",
  NAD_MARKSHEET: "NAD-DigiLocker — semester mark sheets",
  NAD_DEGREE: "NAD-DigiLocker — degree certificates",
};

export async function generateNadBatch(ctx: AuthContext, raw: unknown) {
  if (!can(ctx, "apaar.manage")) throw forbidden();
  const v = z.object({ kind: z.enum(["ABC_CREDITS", "NAD_MARKSHEET", "NAD_DEGREE"]), termId: z.string().nullable().optional() }).parse(raw);
  if (v.kind !== "NAD_DEGREE" && !v.termId) throw invalid("Choose the term whose published results to upload.");
  const inst = await db.institution.findFirstOrThrow();
  const org = (await getSetting("nep")).nadIssuerName || inst.name;
  const term = v.termId ? await db.academicTerm.findUnique({ where: { id: v.termId } }) : null;
  if (v.termId && !term) throw notFound("Term");
  const { rows, skipped } = v.kind === "ABC_CREDITS" ? await abcCreditRows(v.termId!, org) : v.kind === "NAD_MARKSHEET" ? await nadMarksheetRows(v.termId!, org) : await nadDegreeRows(org);
  if (!rows.length && !skipped.length) throw invalid(v.kind === "NAD_DEGREE" ? "There are no new degree certificates to upload." : "There are no published results for this term.");
  return db.$transaction(async (tx) => {
    const number = await nextNumber(tx, "nad.batch", { prefix: "NAD/{YYYY}/", padding: 4 });
    const b = await tx.nadBatch.create({
      data: { number, kind: v.kind, termId: v.termId ?? null, title: `${NAD_KIND_LABEL[v.kind]}${term ? ` · ${term.name}` : ""}`, rows: rows as Prisma.InputJsonValue, rowCount: rows.length, skipped: skipped as Prisma.InputJsonValue, createdById: ctx.user.id },
    });
    await audit({ ...actor(ctx), action: "nad.batch.generate", resourceType: "nadBatch", resourceId: b.id, summary: `${number}: ${rows.length} row(s), ${skipped.length} student(s) held back` }, tx);
    return b;
  });
}

const MOVES: Record<NadBatchStatus, NadBatchStatus[]> = { GENERATED: ["SUBMITTED"], SUBMITTED: ["ACKNOWLEDGED", "REJECTED"], ACKNOWLEDGED: [], REJECTED: [] };

export async function setNadBatchStatus(ctx: AuthContext, id: string, raw: unknown) {
  if (!can(ctx, "apaar.manage")) throw forbidden();
  const v = z.object({ status: z.enum(["SUBMITTED", "ACKNOWLEDGED", "REJECTED"]), reference: z.string().trim().max(120).nullable().optional(), remarks: z.string().trim().max(2000).nullable().optional() }).parse(raw);
  const b = await db.nadBatch.findUnique({ where: { id } });
  if (!b) throw notFound("Batch");
  if (!MOVES[b.status].includes(v.status)) throw workflowError(`A ${b.status.toLowerCase()} batch cannot be marked ${v.status.toLowerCase()}.`);
  if (v.status === "ACKNOWLEDGED" && !v.reference && !b.reference) throw invalid("Enter the portal's acknowledgement reference.");
  const now = new Date();
  await db.nadBatch.update({ where: { id }, data: { status: v.status, reference: v.reference ?? b.reference, remarks: v.remarks ?? b.remarks, ...(v.status === "SUBMITTED" ? { submittedAt: now } : { respondedAt: now }) } });
  await audit({ ...actor(ctx), action: "nad.batch.status", resourceType: "nadBatch", resourceId: id, summary: `${b.number}: ${b.status} → ${v.status}${v.reference ? ` (${v.reference})` : ""}` });
}

/** Header order: fixed identity columns first, then subject columns in numeric order. */
export function batchColumns(rows: Row[]): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
  const keys = [...seen];
  const sub = (k: string) => /^SUB(\d+)/.exec(k);
  return [...keys.filter((k) => !sub(k)), ...keys.filter((k) => sub(k)).sort((a, b) => Number(sub(a)![1]) - Number(sub(b)![1]) || keys.indexOf(a) - keys.indexOf(b))];
}

export async function loadNadBatch(ctx: AuthContext, id: string) {
  if (!can(ctx, "apaar.manage")) throw forbidden();
  const b = await db.nadBatch.findUnique({ where: { id }, include: { term: { select: { name: true } } } });
  if (!b) throw notFound("Batch");
  return { batch: b, rows: b.rows as Row[], skipped: b.skipped as ReturnType<typeof skip>[] };
}
