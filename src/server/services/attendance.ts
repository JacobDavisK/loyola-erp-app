import "server-only";
import { z } from "zod";
import { AttendanceMark } from "@/generated/prisma/enums";
import { summarise, type AttendanceSummary, type Mark } from "@/lib/domain/attendance";
import { canTakeAttendance, loadStudentFor, offeringWhere } from "@/server/auth/access";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { attendancePolicy, getSetting } from "@/server/services/settings";

async function meetingFor(ctx: AuthContext, meetingId: string) {
  const m = await db.classMeeting.findFirst({
    where: { id: meetingId, offering: offeringWhere(ctx) },
    include: { offering: { include: { course: { select: { code: true, title: true, departmentId: true } }, instructors: { select: { userId: true } }, term: { select: { name: true, status: true } } } }, room: { select: { code: true } } },
  });
  if (!m) throw notFound("Class session");
  const allowed = canTakeAttendance(ctx, { courseDepartmentId: m.offering.course.departmentId, instructorIds: m.offering.instructors.map((i) => i.userId) });
  return { meeting: m, allowed };
}

/** Roster for a class session: registered students with their current mark. */
export async function roster(ctx: AuthContext, meetingId: string) {
  const { meeting, allowed } = await meetingFor(ctx, meetingId);
  if (!allowed) throw forbidden();
  const [regs, records] = await Promise.all([
    db.courseRegistration.findMany({
      where: { offeringId: meeting.offeringId, OR: [{ status: "REGISTERED" }, { status: { in: ["COMPLETED", "WITHDRAWN", "DROPPED"] }, registeredAt: { lte: meeting.startsAt }, OR: [{ droppedAt: null }, { droppedAt: { gt: meeting.startsAt } }] }] },
      include: { student: { select: { id: true, studentNo: true, firstName: true, lastName: true, section: true, status: true } } },
      orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
    }),
    db.attendanceRecord.findMany({ where: { meetingId } }),
  ]);
  const byStudent = new Map(records.map((r) => [r.studentId, r]));
  const { attendanceEditWindowHours } = await getSetting("academic");
  const editableUntil = new Date(meeting.endsAt.getTime() + attendanceEditWindowHours * 3_600_000);
  return {
    meeting,
    editableByInstructor: new Date() <= editableUntil,
    editableUntil,
    canCorrect: can(ctx, "attendance.manage", meeting.offering.course.departmentId),
    students: regs.map((r) => ({ ...r.student, mark: byStudent.get(r.student.id)?.mark ?? null, remarks: byStudent.get(r.student.id)?.remarks ?? null })),
  };
}

const saveSchema = z.object({
  topic: z.string().trim().max(200).nullable().optional(),
  marks: z.array(z.object({ studentId: z.string(), mark: z.enum(AttendanceMark), remarks: z.string().trim().max(200).nullable().optional() })).min(1).max(1000),
});

/**
 * Record attendance for a session. Instructors may edit within the configured window after the class;
 * later corrections need attendance.manage and are audited with old and new marks.
 */
export async function saveAttendance(ctx: AuthContext, meetingId: string, raw: unknown) {
  const v = saveSchema.parse(raw);
  const r = await roster(ctx, meetingId);
  const { meeting } = r;
  if (meeting.status === "CANCELLED") throw workflowError("This class session was cancelled.");
  if (meeting.startsAt.getTime() - Date.now() > 30 * 60_000) throw workflowError("Attendance can be taken from 30 minutes before the class starts.");
  const correcting = !r.editableByInstructor;
  if (correcting && !r.canCorrect) throw workflowError(`The edit window closed on ${r.editableUntil.toLocaleString("en-GB")}. Ask your HoD to correct it.`);
  const roll = new Map(r.students.map((s) => [s.id, s]));
  const unknown = v.marks.filter((m) => !roll.has(m.studentId));
  if (unknown.length) throw workflowError("Some students are not registered in this class.");

  const changes: { studentNo: string; from: string | null; to: string }[] = [];
  await db.$transaction(async (tx) => {
    for (const m of v.marks) {
      const prev = roll.get(m.studentId)!;
      if (prev.mark === m.mark && (prev.remarks ?? null) === (m.remarks ?? null)) continue;
      await tx.attendanceRecord.upsert({
        where: { meetingId_studentId: { meetingId, studentId: m.studentId } },
        create: { meetingId, studentId: m.studentId, mark: m.mark, remarks: m.remarks ?? null, markedById: ctx.user.id },
        update: { mark: m.mark, remarks: m.remarks ?? null, markedById: ctx.user.id, markedAt: new Date() },
      });
      changes.push({ studentNo: prev.studentNo, from: prev.mark, to: m.mark });
    }
    await tx.classMeeting.update({ where: { id: meetingId }, data: { status: "HELD", topic: v.topic ?? meeting.topic, takenById: meeting.takenById ?? ctx.user.id, takenAt: meeting.takenAt ?? new Date() } });
    const corrections = changes.filter((c) => c.from !== null);
    await audit(
      {
        actorId: ctx.user.id, actorName: ctx.user.name, action: correcting ? "attendance.correct" : "attendance.record", resourceType: "classMeeting", resourceId: meetingId,
        summary: `${meeting.offering.course.code}-${meeting.offering.section} ${meeting.date.toISOString().slice(0, 10)}: ${changes.length - corrections.length} marked, ${corrections.length} changed`,
        oldValue: corrections.length ? corrections.map((c) => ({ student: c.studentNo, mark: c.from })) : undefined,
        newValue: corrections.length ? corrections.map((c) => ({ student: c.studentNo, mark: c.to })) : { marked: changes.length },
      },
      tx,
    );
  });
  return { changed: changes.length };
}

/** Per-class attendance summary for one student in a term (student portal, guardian view, student record). */
export async function studentAttendance(ctx: AuthContext, studentId: string, termId: string) {
  await loadStudentFor(ctx, studentId);
  const policy = await attendancePolicy();
  const regs = await db.courseRegistration.findMany({
    where: { studentId, offering: { termId }, status: { in: ["REGISTERED", "COMPLETED"] } },
    include: { offering: { include: { course: { select: { code: true, title: true } } } } },
    orderBy: { offering: { course: { code: "asc" } } },
  });
  const now = new Date();
  const out: { offeringId: string; code: string; title: string; section: string; summary: AttendanceSummary }[] = [];
  for (const r of regs) {
    const [marks, remaining] = await Promise.all([
      db.attendanceRecord.findMany({ where: { studentId, meeting: { offeringId: r.offeringId, status: "HELD" } }, select: { mark: true } }),
      db.classMeeting.count({ where: { offeringId: r.offeringId, status: "SCHEDULED", startsAt: { gt: now } } }),
    ]);
    out.push({ offeringId: r.offeringId, code: r.offering.course.code, title: r.offering.course.title, section: r.offering.section, summary: summarise(marks.map((m) => m.mark as Mark), policy, remaining) });
  }
  const all = out.reduce((a, o) => a + o.summary.counted, 0);
  const attended = out.reduce((a, o) => a + o.summary.attended, 0);
  return { classes: out, overallPercent: all ? Math.round((attended / all) * 1000) / 10 : null, policy };
}

/** Class-level report: every registered student's summary (instructors, HoD). */
export async function offeringAttendanceReport(ctx: AuthContext, offeringId: string) {
  const o = await db.courseOffering.findFirst({ where: { id: offeringId, ...offeringWhere(ctx) }, include: { course: { select: { departmentId: true } }, instructors: { select: { userId: true } } } });
  if (!o) throw notFound("Class");
  const allowed = canTakeAttendance(ctx, { courseDepartmentId: o.course.departmentId, instructorIds: o.instructors.map((i) => i.userId) }) || can(ctx, "attendance.view", o.course.departmentId);
  if (!allowed) throw forbidden();
  const policy = await attendancePolicy();
  const now = new Date();
  const [regs, held, remaining, records] = await Promise.all([
    db.courseRegistration.findMany({ where: { offeringId, status: { in: ["REGISTERED", "COMPLETED"] } }, include: { student: { select: { id: true, studentNo: true, firstName: true, lastName: true } } }, orderBy: { student: { lastName: "asc" } } }),
    db.classMeeting.count({ where: { offeringId, status: "HELD" } }),
    db.classMeeting.count({ where: { offeringId, status: "SCHEDULED", startsAt: { gt: now } } }),
    db.attendanceRecord.findMany({ where: { meeting: { offeringId, status: "HELD" } }, select: { studentId: true, mark: true } }),
  ]);
  const marksBy = new Map<string, Mark[]>();
  for (const r of records) (marksBy.get(r.studentId) ?? marksBy.set(r.studentId, []).get(r.studentId)!).push(r.mark as Mark);
  return { held, remaining, policy, rows: regs.map((r) => ({ student: r.student, summary: summarise(marksBy.get(r.student.id) ?? [], policy, remaining) })) };
}
