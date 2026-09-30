import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { summarise, type Mark } from "@/lib/domain/attendance";
import { toMinor, percentOf, fromMinor } from "@/lib/domain/money";
import { checkEligibility, criteriaSchema } from "@/lib/domain/scholarship";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { currentCgpa } from "@/server/services/academic-record";
import { audit } from "@/server/services/audit";
import { applyConcession } from "@/server/services/finance-core";
import { attendancePolicy } from "@/server/services/settings";
import { startWorkflow } from "@/server/services/workflow";
import type { ScholarshipData } from "@/server/workflow/modules/finance";

export const schemeSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/),
    name: z.string().trim().min(3).max(160),
    sponsor: z.string().trim().max(160).nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    amount: z.number().positive().nullable().optional(),
    percent: z.number().min(1).max(100).nullable().optional(),
    seats: z.number().int().positive().nullable().optional(),
    opensAt: z.coerce.date().nullable().optional(),
    closesAt: z.coerce.date().nullable().optional(),
    status: z.enum(["DRAFT", "OPEN", "CLOSED"]),
    criteria: criteriaSchema,
  })
  .refine((v) => (v.amount ? 1 : 0) + (v.percent ? 1 : 0) === 1, { path: ["amount"], message: "Set either a fixed amount or a percentage" });

export async function saveScheme(ctx: AuthContext, id: string | null, raw: unknown) {
  if (!can(ctx, "scholarship.manage")) throw forbidden();
  const v = schemeSchema.parse(raw);
  const data = { ...v, amount: v.amount ? v.amount.toFixed(2) : null, percent: v.percent ?? null, sponsor: v.sponsor ?? null, description: v.description ?? null, seats: v.seats ?? null, opensAt: v.opensAt ?? null, closesAt: v.closesAt ?? null, criteria: v.criteria as Prisma.InputJsonValue };
  const s = id ? await db.scholarshipScheme.update({ where: { id }, data }) : await db.scholarshipScheme.create({ data });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: id ? "scholarship.scheme.update" : "scholarship.scheme.create", resourceType: "scholarshipScheme", resourceId: s.id, summary: `${v.code} ${v.name}` });
  return s;
}

/** The facts the rules need about a student, gathered from academic records. */
async function applicantFacts(studentId: string, declaredIncome: number | null) {
  const s = await db.student.findUniqueOrThrow({ where: { id: studentId }, include: { program: { select: { code: true } } } });
  const [cgpa, failures, marks] = await Promise.all([
    currentCgpa(studentId),
    db.courseResult.count({ where: { studentId, isCurrent: true, publishedAt: { not: null }, status: { in: ["FAIL", "ABSENT"] } } }),
    db.attendanceRecord.findMany({ where: { studentId, meeting: { status: "HELD", offering: { term: { isCurrent: true } } } }, select: { mark: true } }),
  ]);
  const att = summarise(marks.map((m) => m.mark as Mark), await attendancePolicy());
  return { cgpa, attendancePercent: att.percent, declaredIncome, programCode: s.program.code, category: s.category, gender: s.gender, semester: s.currentSemester, failures, status: s.status };
}

export async function eligibilityPreview(ctx: AuthContext, schemeId: string, declaredIncome: number | null) {
  if (!ctx.subject.studentId) throw forbidden();
  const scheme = await db.scholarshipScheme.findUnique({ where: { id: schemeId } });
  if (!scheme) throw notFound("Scholarship");
  return checkEligibility(criteriaSchema.parse(scheme.criteria), await applicantFacts(ctx.subject.studentId, declaredIncome));
}

export async function applyForScholarship(ctx: AuthContext, raw: unknown) {
  if (!can(ctx, "scholarship.apply") || !ctx.subject.studentId) throw forbidden();
  const v = z.object({ schemeId: z.string().min(1), statement: z.string().trim().min(30, "Write at least a few sentences").max(3000), declaredIncome: z.number().min(0).nullable().optional() }).parse(raw);
  const scheme = await db.scholarshipScheme.findUnique({ where: { id: v.schemeId } });
  if (!scheme || scheme.status !== "OPEN") throw workflowError("This scholarship is not open for applications.");
  const now = new Date();
  if ((scheme.opensAt && now < scheme.opensAt) || (scheme.closesAt && now > scheme.closesAt)) throw workflowError("Applications for this scholarship are closed.");
  const year = await db.academicYear.findFirst({ where: { isCurrent: true } });
  if (!year) throw workflowError("No current academic year is set.");
  if (await db.scholarshipApplication.findUnique({ where: { schemeId_studentId_academicYearId: { schemeId: scheme.id, studentId: ctx.subject.studentId, academicYearId: year.id } } })) throw conflict("You have already applied for this scholarship this year.");
  const facts = await applicantFacts(ctx.subject.studentId, v.declaredIncome ?? null);
  const check = checkEligibility(criteriaSchema.parse(scheme.criteria), facts);
  if (!check.eligible) throw workflowError(`You do not meet: ${check.checks.filter((c) => !c.ok).map((c) => c.rule.toLowerCase()).join(", ")}.`);
  const student = await db.student.findUniqueOrThrow({ where: { id: ctx.subject.studentId } });
  // Proposed award: fixed amount, or a percentage of tuition invoiced this academic year.
  let award = scheme.amount ? toMinor(scheme.amount) : 0;
  if (scheme.percent) {
    const tuition = await db.invoiceLine.aggregate({ where: { feeHead: { category: "TUITION" }, invoice: { studentId: student.id, cancelledAt: null, issueDate: { gte: year.startDate, lte: year.endDate } } }, _sum: { amount: true } });
    award = percentOf(toMinor(tuition._sum.amount ?? 0), scheme.percent);
  }
  return db.$transaction(async (tx) => {
    const app = await tx.scholarshipApplication.create({
      data: { schemeId: scheme.id, studentId: student.id, academicYearId: year.id, statement: v.statement, declaredIncome: v.declaredIncome != null ? v.declaredIncome.toFixed(2) : null, eligibility: check as unknown as Prisma.InputJsonValue, awardAmount: fromMinor(award), status: "UNDER_REVIEW" },
    });
    const data: ScholarshipData = { applicationId: app.id, studentId: student.id, studentNo: student.studentNo, studentName: `${student.firstName} ${student.lastName}`, scheme: scheme.name, eligible: check.eligible, proposedAward: award / 100, statement: v.statement.slice(0, 500) };
    return startWorkflow(tx, { id: ctx.user.id, name: ctx.user.name }, {
      key: "scholarship.application", resourceType: "scholarshipApplication", resourceId: app.id, title: `${scheme.name}: ${data.studentName}`,
      summary: `Proposed award ${data.proposedAward.toFixed(2)}`, departmentId: student.departmentId, subjectUserId: student.userId, data: data as unknown as Record<string, unknown>,
    });
  });
}

/**
 * Credit an approved award against the student's open invoices (tuition first), as scholarship concessions
 * posted to the ledger. Any part that cannot be applied stays pending for the next invoice.
 */
export async function disburseScholarship(ctx: AuthContext, applicationId: string) {
  if (!can(ctx, "scholarship.manage")) throw forbidden();
  const app = await db.scholarshipApplication.findUnique({ where: { id: applicationId }, include: { scheme: true } });
  if (!app) throw notFound("Application");
  if (app.status !== "APPROVED") throw workflowError("Only approved applications can be disbursed.");
  let remaining = toMinor(app.awardAmount);
  if (remaining <= 0) throw invalid("The award amount is zero.");
  const invoices = await db.invoice.findMany({ where: { studentId: app.studentId, status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, orderBy: { dueDate: "asc" } });
  if (!invoices.length) throw workflowError("The student has no open invoice to credit the award against yet.");
  const actor = { id: ctx.user.id, name: ctx.user.name };
  await db.$transaction(async (tx) => {
    for (const inv of invoices) {
      if (remaining <= 0) break;
      const due = toMinor(inv.total) - toMinor(inv.amountPaid);
      const take = Math.min(due, remaining);
      if (take <= 0) continue;
      const c = await tx.concession.create({ data: { studentId: app.studentId, invoiceId: inv.id, amount: fromMinor(take), kind: "SCHOLARSHIP", reason: `${app.scheme.name} (${app.scheme.code})`, requestedById: ctx.user.id, scholarshipApplicationId: app.id } });
      await applyConcession(tx, c.id, actor);
      remaining -= take;
    }
    const credited = toMinor(app.awardAmount) - remaining;
    if (remaining === 0) await tx.scholarshipApplication.update({ where: { id: app.id }, data: { status: "DISBURSED" } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "scholarship.disburse", resourceType: "student", resourceId: app.studentId, summary: `${app.scheme.code}: ${fromMinor(credited)} credited${remaining ? `, ${fromMinor(remaining)} pending` : ""}` }, tx);
  });
  return { remaining };
}
