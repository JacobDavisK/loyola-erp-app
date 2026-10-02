import "server-only";
import { z } from "zod";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, invalid, notFound } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { notify } from "@/server/services/notifications";

/**
 * Campus health centre. Visits by students and staff are recorded by the medical officer; the record is
 * confidential to the health centre and to the patient. A visit can carry a rest advice that the student's
 * mentor and class teachers are told about (without the diagnosis), and a medical certificate the student
 * can attach to a leave or attendance-condonation request.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });

const visitSchema = z.object({
  patient: z.enum(["STUDENT", "EMPLOYEE"]),
  rollOrCode: z.string().trim().min(2).max(40),
  complaint: z.string().trim().min(2).max(1000),
  temperature: z.number().min(30).max(45).nullable().optional(),
  pulse: z.number().int().min(20).max(250).nullable().optional(),
  bp: z.string().trim().regex(/^\d{2,3}\/\d{2,3}$/).nullable().optional().or(z.literal("")),
  diagnosis: z.string().trim().max(1000).nullable().optional(),
  treatment: z.string().trim().max(1000).nullable().optional(),
  prescription: z.string().trim().max(2000).nullable().optional(),
  referral: z.string().trim().max(300).nullable().optional(),
  restDays: z.number().int().min(0).max(30).default(0),
  certificate: z.boolean().default(false),
});

export async function recordVisit(ctx: AuthContext, raw: unknown) {
  if (!can(ctx, "health.manage")) throw forbidden();
  const v = visitSchema.parse(raw);
  const key = v.rollOrCode.toUpperCase();
  const student = v.patient === "STUDENT" ? await db.student.findFirst({ where: { studentNo: key } }) : null;
  const employee = v.patient === "EMPLOYEE" ? await db.employee.findFirst({ where: { employeeNo: key } }) : null;
  if (!student && !employee) throw notFound(v.patient === "STUDENT" ? "Student" : "Employee");
  if (v.certificate && !v.diagnosis) throw invalid("A certificate needs a diagnosis.");
  const vitals = { ...(v.temperature ? { temperature: v.temperature } : {}), ...(v.pulse ? { pulse: v.pulse } : {}), ...(v.bp ? { bp: v.bp } : {}) };
  const row = await db.clinicVisit.create({
    data: { studentId: student?.id ?? null, employeeId: employee?.id ?? null, complaint: v.complaint, vitals: Object.keys(vitals).length ? vitals : undefined, diagnosis: v.diagnosis || null, treatment: v.treatment || null, prescription: v.prescription || null, referral: v.referral || null, restDays: v.restDays, certificate: v.certificate, attendedById: ctx.user.id },
  });
  await audit({ ...actor(ctx), action: "clinic.visit", resourceType: "clinicVisit", resourceId: row.id, summary: student ? student.studentNo : employee!.employeeNo });
  if (student && v.restDays > 0) {
    const mentors = await db.mentorAssignment.findMany({ where: { studentId: student.id, endsOn: null }, select: { mentorId: true } });
    await notify({ userIds: [student.userId, ...mentors.map((m) => m.mentorId)], type: "clinic.rest", title: `Medical rest advised: ${student.studentNo}`, body: `${v.restDays} day(s) from ${new Date().toISOString().slice(0, 10)}${v.certificate ? "; a certificate was issued" : ""}.` });
  }
  return row;
}

/** A patient's own visits, or any patient's for the health centre. */
export async function visitsFor(ctx: AuthContext, who: { studentId?: string; employeeId?: string }) {
  const own = (who.studentId && who.studentId === ctx.subject.studentId) || (who.employeeId && who.employeeId === ctx.subject.employeeId);
  if (!own && !can(ctx, "health.manage")) throw forbidden();
  return db.clinicVisit.findMany({ where: who.studentId ? { studentId: who.studentId } : { employeeId: who.employeeId }, orderBy: { visitedAt: "desc" }, take: 100 });
}

export async function getVisit(ctx: AuthContext, id: string) {
  const v = await db.clinicVisit.findUnique({ where: { id }, include: { student: { select: { studentNo: true, firstName: true, lastName: true } }, employee: { select: { employeeNo: true, firstName: true, lastName: true } } } });
  if (!v) throw notFound("Visit");
  const own = (v.studentId && v.studentId === ctx.subject.studentId) || (v.employeeId && v.employeeId === ctx.subject.employeeId);
  if (!own && !can(ctx, "health.manage")) throw forbidden();
  return v;
}

/** Counts by day and the commonest complaints — for spotting outbreaks. Names are not included. */
export async function clinicSummary(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  const visits = await db.clinicVisit.findMany({ where: { visitedAt: { gte: since } }, select: { visitedAt: true, complaint: true, diagnosis: true, studentId: true } });
  const byDay = new Map<string, number>();
  const words = new Map<string, number>();
  for (const v of visits) {
    const d = v.visitedAt.toISOString().slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
    const k = (v.diagnosis || v.complaint).toLowerCase().split(/[,.;]/)[0].trim().slice(0, 40);
    words.set(k, (words.get(k) ?? 0) + 1);
  }
  return {
    total: visits.length,
    students: visits.filter((v) => v.studentId).length,
    byDay: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
    top: [...words.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, count]) => ({ label, count })),
  };
}
