import "server-only";
import { z } from "zod";
import { loadStudentFor } from "@/server/auth/access";
import { type AuthContext, can, isSuperAdmin } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, invalid, notFound } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { notify } from "@/server/services/notifications";

/**
 * Faculty mentoring (academic advising). The HoD assigns each student a mentor; the mentor records
 * meetings — a summary and action items the student sees, and private notes only the mentor and
 * success managers see — and follows up. Mentors see their mentees' records, risk and cases.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });
const today = () => new Date(new Date().toISOString().slice(0, 10));

export async function assignMentor(ctx: AuthContext, raw: unknown) {
  const v = z.object({ mentorId: z.string(), studentIds: z.array(z.string()).min(1).max(200) }).parse(raw);
  const mentor = await db.user.findFirst({ where: { id: v.mentorId, userType: "STAFF", status: "ACTIVE", deletedAt: null } });
  if (!mentor) throw invalid("Choose a member of staff as the mentor.");
  const students = await db.student.findMany({ where: { id: { in: v.studentIds }, deletedAt: null }, select: { id: true, departmentId: true, studentNo: true, userId: true } });
  if (students.length !== v.studentIds.length) throw notFound("Student");
  for (const s of students) if (!can(ctx, "mentoring.manage", s.departmentId)) throw forbidden();
  const t = today();
  await db.$transaction(async (tx) => {
    for (const s of students) {
      const current = await tx.mentorAssignment.findFirst({ where: { studentId: s.id, endsOn: null } });
      if (current?.mentorId === mentor.id) continue;
      if (current) await tx.mentorAssignment.update({ where: { id: current.id }, data: { endsOn: t < current.startsOn ? current.startsOn : t } });
      await tx.mentorAssignment.create({ data: { studentId: s.id, mentorId: mentor.id, startsOn: t, assignedById: ctx.user.id } });
    }
    await notify({ userIds: [mentor.id], type: "mentoring.assigned", title: `${students.length} mentee(s) assigned to you`, link: "/mentoring" }, tx);
    await notify({ userIds: students.map((s) => s.userId), type: "mentoring.assigned", title: `${mentor.name} is now your mentor`, link: "/portal/support", email: false }, tx);
    await audit({ ...actor(ctx), action: "mentoring.assign", resourceType: "user", resourceId: mentor.id, summary: `${mentor.name}: ${students.map((s) => s.studentNo).join(", ")}` }, tx);
  });
}

export async function endMentorship(ctx: AuthContext, assignmentId: string) {
  const a = await db.mentorAssignment.findUnique({ where: { id: assignmentId }, include: { student: { select: { departmentId: true, studentNo: true } } } });
  if (!a || a.endsOn) throw notFound("Mentorship");
  if (!can(ctx, "mentoring.manage", a.student.departmentId)) throw forbidden();
  const t = today();
  await db.mentorAssignment.update({ where: { id: assignmentId }, data: { endsOn: t < a.startsOn ? a.startsOn : t } });
  await audit({ ...actor(ctx), action: "mentoring.end", resourceType: "student", resourceId: a.studentId, summary: `${a.student.studentNo}: mentorship ended` });
}

export async function isMentorOf(ctx: AuthContext, studentId: string) {
  return !!(await db.mentorAssignment.findFirst({ where: { studentId, mentorId: ctx.user.id, endsOn: null }, select: { id: true } }));
}

const meetingSchema = z.object({
  heldOn: z.coerce.date(),
  mode: z.enum(["IN_PERSON", "ONLINE", "PHONE"]),
  summary: z.string().trim().min(10).max(4000),
  actionItems: z.string().trim().max(2000).nullable().optional(),
  privateNotes: z.string().trim().max(4000).nullable().optional(),
  followUpOn: z.coerce.date().nullable().optional(),
});

export async function recordMeeting(ctx: AuthContext, studentId: string, raw: unknown) {
  if (!(await isMentorOf(ctx, studentId)) && !isSuperAdmin(ctx)) throw forbidden("Only the student's mentor records mentoring meetings.");
  const v = meetingSchema.parse(raw);
  if (v.heldOn.getTime() > Date.now() + 3_600_000) throw invalid("Record meetings after they happen.");
  const items = (v.actionItems ?? "").split(/\r?\n/).map((x) => x.replace(/^[-*•]\s*/, "").trim()).filter(Boolean).slice(0, 20).map((text) => ({ text, done: false }));
  const s = await db.student.findUniqueOrThrow({ where: { id: studentId }, select: { userId: true, studentNo: true } });
  const m = await db.mentorMeeting.create({ data: { studentId, mentorId: ctx.user.id, heldOn: v.heldOn, mode: v.mode, summary: v.summary, actionItems: items, privateNotes: v.privateNotes ?? null, followUpOn: v.followUpOn ?? null } });
  if (s.userId) await notify({ userIds: [s.userId], type: "mentoring.meeting", title: "Your mentor recorded a meeting", body: items.length ? `${items.length} action item(s)` : undefined, link: "/portal/support", email: false });
  await audit({ ...actor(ctx), action: "mentoring.meeting", resourceType: "student", resourceId: studentId, summary: `${s.studentNo}: meeting on ${v.heldOn.toISOString().slice(0, 10)}` });
  return m;
}

/** The student or the mentor ticks off an action item. */
export async function toggleActionItem(ctx: AuthContext, meetingId: string, index: number) {
  const m = await db.mentorMeeting.findUnique({ where: { id: meetingId } });
  if (!m) throw notFound("Meeting");
  if (m.mentorId !== ctx.user.id && ctx.subject.studentId !== m.studentId) throw forbidden();
  const items = (m.actionItems as { text: string; done: boolean }[]) ?? [];
  if (!items[index]) throw invalid("No such action item.");
  items[index] = { ...items[index], done: !items[index].done };
  await db.mentorMeeting.update({ where: { id: meetingId }, data: { actionItems: items } });
}

/** Meetings for a student, with private notes only for the mentor who wrote them and success managers. */
export async function meetingsFor(ctx: AuthContext, studentId: string) {
  const self = ctx.subject.studentId === studentId || ctx.subject.wardStudentIds.includes(studentId);
  let departmentId: string | null = null;
  if (!self) departmentId = (await loadStudentFor(ctx, studentId)).departmentId;
  const mentor = await isMentorOf(ctx, studentId);
  if (!self && !mentor && !can(ctx, "success.view", departmentId) && !isSuperAdmin(ctx)) throw forbidden();
  const rows = await db.mentorMeeting.findMany({ where: { studentId }, orderBy: { heldOn: "desc" }, include: { mentor: { select: { name: true } } } });
  return rows.map((m) => ({ ...m, privateNotes: !self && (m.mentorId === ctx.user.id || can(ctx, "success.manage", departmentId) || isSuperAdmin(ctx)) ? m.privateNotes : null }));
}
