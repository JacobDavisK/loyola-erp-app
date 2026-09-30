import "server-only";
import { z } from "zod";
import { ExamSlot, ExamType, SessionStatus, TermType } from "@/generated/prisma/enums";
import { examinationWhere } from "@/server/auth/access";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { conflict, forbidden, invalid, notFound } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { notify } from "@/server/services/notifications";

// ───────────────────────── Sessions ─────────────────────────

export const sessionSchema = z
  .object({
    name: z.string().trim().min(5).max(120),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,16}$/, "3–16 letters, digits or dashes"),
    academicYearId: z.string().min(1, "Choose an academic year"),
    termType: z.enum(TermType),
    examType: z.enum(ExamType),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    settingDeadline: z.coerce.date().nullable().optional(),
    moderationDeadline: z.coerce.date().nullable().optional(),
    scrutinyDeadline: z.coerce.date().nullable().optional(),
    approvalDeadline: z.coerce.date().nullable().optional(),
    programIds: z.array(z.string()).default([]),
    description: z.string().max(1000).nullable().optional(),
  })
  .refine((v) => v.endDate >= v.startDate, { path: ["endDate"], message: "End date must be after the start date" })
  .refine(
    (v) => {
      const d = [v.settingDeadline, v.moderationDeadline, v.scrutinyDeadline, v.approvalDeadline].filter(Boolean) as Date[];
      return d.every((x, i) => i === 0 || x >= d[i - 1]);
    },
    { path: ["approvalDeadline"], message: "Deadlines must be in order: setting → moderation → scrutiny → approval" },
  );

/** Allowed session status progression (controllers may also step back one stage). */
const SESSION_FLOW: SessionStatus[] = ["PLANNING", "OPEN", "PAPER_SETTING", "MODERATION", "SCRUTINY", "APPROVAL", "LOCKED", "PUBLISHED", "ARCHIVED"];

export async function createSession(ctx: AuthContext, raw: unknown) {
  if (!can(ctx, "session.manage")) throw forbidden();
  const v = sessionSchema.parse(raw);
  if (await db.examinationSession.findUnique({ where: { code: v.code } })) throw conflict(`Session code ${v.code} already exists.`);
  const s = await db.examinationSession.create({
    data: {
      name: v.name,
      code: v.code,
      academicYearId: v.academicYearId,
      termType: v.termType,
      examType: v.examType,
      startDate: v.startDate,
      endDate: v.endDate,
      settingDeadline: v.settingDeadline ?? null,
      moderationDeadline: v.moderationDeadline ?? null,
      scrutinyDeadline: v.scrutinyDeadline ?? null,
      approvalDeadline: v.approvalDeadline ?? null,
      description: v.description ?? null,
      programs: { connect: v.programIds.map((id) => ({ id })) },
    },
  });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "session.create", resourceType: "session", resourceId: s.id, summary: `${v.code} — ${v.name}`, newValue: v });
  return s;
}

export async function updateSession(ctx: AuthContext, id: string, raw: unknown) {
  if (!can(ctx, "session.manage")) throw forbidden();
  const v = sessionSchema.parse(raw);
  const before = await db.examinationSession.findUnique({ where: { id } });
  if (!before) throw notFound("Session");
  if (["LOCKED", "PUBLISHED", "ARCHIVED"].includes(before.status)) throw invalid("A locked session cannot be edited.");
  const s = await db.examinationSession.update({
    where: { id },
    data: {
      name: v.name,
      academicYearId: v.academicYearId,
      termType: v.termType,
      examType: v.examType,
      startDate: v.startDate,
      endDate: v.endDate,
      settingDeadline: v.settingDeadline ?? null,
      moderationDeadline: v.moderationDeadline ?? null,
      scrutinyDeadline: v.scrutinyDeadline ?? null,
      approvalDeadline: v.approvalDeadline ?? null,
      description: v.description ?? null,
      programs: { set: v.programIds.map((pid) => ({ id: pid })) },
    },
  });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "session.update", resourceType: "session", resourceId: id, summary: before.code, oldValue: before, newValue: v });
  return s;
}

export async function setSessionStatus(ctx: AuthContext, id: string, status: SessionStatus) {
  if (!can(ctx, "session.manage")) throw forbidden();
  const s = await db.examinationSession.findUnique({ where: { id }, include: { examinations: { select: { id: true, papers: { where: { deletedAt: null }, select: { status: true } } } } } });
  if (!s) throw notFound("Session");
  const from = SESSION_FLOW.indexOf(s.status);
  const to = SESSION_FLOW.indexOf(status);
  if (Math.abs(to - from) !== 1) throw invalid("Sessions move one stage at a time.");
  if (status === "LOCKED") {
    if (!can(ctx, "exam.lock")) throw forbidden("Only the Controller of Examinations can lock a session.");
    const unfinished = s.examinations.filter((e) => !e.papers.some((p) => ["LOCKED", "RELEASED", "ARCHIVED"].includes(p.status))).length;
    if (unfinished) throw invalid(`${unfinished} examination(s) do not yet have a locked paper.`);
  }
  await db.$transaction(async (tx) => {
    await tx.examinationSession.update({ where: { id }, data: { status } });
    if (status === "LOCKED") await tx.examination.updateMany({ where: { sessionId: id }, data: { isLocked: true } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "session.status", resourceType: "session", resourceId: id, summary: `${s.code}: ${s.status} → ${status}`, oldValue: { status: s.status }, newValue: { status } }, tx);
  });
}

// ───────────────────────── Examinations ─────────────────────────

/** Add courses to a session (one examination per course), inheriting the course pattern. */
export async function addExaminations(ctx: AuthContext, sessionId: string, courseIds: string[]) {
  if (!can(ctx, "exam.manage")) throw forbidden();
  const s = await db.examinationSession.findUnique({ where: { id: sessionId } });
  if (!s) throw notFound("Session");
  if (["LOCKED", "PUBLISHED", "ARCHIVED"].includes(s.status)) throw invalid("This session is locked.");
  const [courses, pattern, template] = await Promise.all([
    db.course.findMany({ where: { id: { in: courseIds }, deletedAt: null }, include: { blueprints: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 1 } } }),
    db.blueprint.findFirst({ where: { isPattern: true, deletedAt: null }, orderBy: { createdAt: "asc" } }),
    db.template.findFirst({ where: { isDefault: true } }),
  ]);
  let created = 0;
  for (const c of courses) {
    const exists = await db.examination.findUnique({ where: { sessionId_courseId: { sessionId, courseId: c.id } } });
    if (exists) continue;
    await db.examination.create({
      data: {
        sessionId,
        courseId: c.id,
        blueprintId: c.blueprints[0]?.id ?? (c.mode !== "PRACTICAL" ? pattern?.id : undefined),
        templateId: template?.id,
        maxMarks: c.externalMarks,
        durationMinutes: c.durationMinutes,
      },
    });
    created++;
  }
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "exam.create", resourceType: "session", resourceId: sessionId, summary: `${created} examination(s) added to ${s.code}` });
  return created;
}

export const examUpdateSchema = z.object({
  moderatorId: z.string().nullable().optional(),
  scrutinizerId: z.string().nullable().optional(),
  blueprintId: z.string().nullable().optional(),
  templateId: z.string().nullable().optional(),
  maxMarks: z.number().int().min(1).max(500).optional(),
  durationMinutes: z.number().int().min(15).max(600).optional(),
  notes: z.string().max(2000).nullable().optional(),
  schedule: z
    .object({ date: z.coerce.date(), slot: z.enum(ExamSlot), startTime: z.string().regex(/^\d{2}:\d{2}$/), venue: z.string().max(120).nullable().optional() })
    .nullable()
    .optional(),
});

async function assertReviewer(userId: string, perm: "moderation.perform" | "scrutiny.perform") {
  const ok = await db.userRole.count({ where: { userId, user: { status: "ACTIVE", deletedAt: null }, role: { permissions: { some: { permission: { key: perm } } } } } });
  if (!ok) throw invalid(perm === "moderation.perform" ? "The selected person is not a moderator." : "The selected person is not a scrutiny officer.");
}

export async function updateExamination(ctx: AuthContext, id: string, raw: unknown) {
  const v = examUpdateSchema.parse(raw);
  const exam = await db.examination.findFirst({ where: { AND: [examinationWhere(ctx), { id }] }, include: { course: true, session: true, schedule: true, assignments: { where: { status: { notIn: ["CANCELLED", "DECLINED"] } } } } });
  if (!exam) throw notFound("Examination");
  if (!can(ctx, "exam.manage", exam.course.departmentId)) throw forbidden();
  if (exam.isLocked) throw invalid("This examination is locked.");
  if (v.moderatorId) {
    await assertReviewer(v.moderatorId, "moderation.perform");
    if (exam.assignments.some((a) => a.setterId === v.moderatorId || a.backupSetterId === v.moderatorId)) throw invalid("A setter of this examination cannot moderate it.");
  }
  if (v.scrutinizerId) await assertReviewer(v.scrutinizerId, "scrutiny.perform");

  await db.$transaction(async (tx) => {
    await tx.examination.update({
      where: { id },
      data: {
        moderatorId: v.moderatorId === undefined ? undefined : v.moderatorId,
        scrutinizerId: v.scrutinizerId === undefined ? undefined : v.scrutinizerId,
        blueprintId: v.blueprintId === undefined ? undefined : v.blueprintId,
        templateId: v.templateId === undefined ? undefined : v.templateId,
        maxMarks: v.maxMarks,
        durationMinutes: v.durationMinutes,
        notes: v.notes === undefined ? undefined : v.notes,
      },
    });
    if (v.schedule) {
      const [hh, mm] = v.schedule.startTime.split(":").map(Number);
      const start = new Date(v.schedule.date);
      start.setHours(hh, mm, 0, 0);
      const end = new Date(start.getTime() + (v.durationMinutes ?? exam.durationMinutes) * 60_000);
      await tx.examSchedule.upsert({
        where: { examinationId: id },
        create: { examinationId: id, date: v.schedule.date, slot: v.schedule.slot, startsAt: start, endsAt: end, venue: v.schedule.venue ?? null },
        update: { date: v.schedule.date, slot: v.schedule.slot, startsAt: start, endsAt: end, venue: v.schedule.venue ?? null },
      });
    }
    if (v.moderatorId && v.moderatorId !== exam.moderatorId) {
      await notify({ userIds: [v.moderatorId], type: "moderation.appointed", title: `Appointed moderator: ${exam.course.code}`, body: `${exam.course.title} — ${exam.session.name}`, link: "/moderation" }, tx);
    }
    if (v.scrutinizerId && v.scrutinizerId !== exam.scrutinizerId) {
      await notify({ userIds: [v.scrutinizerId], type: "scrutiny.appointed", title: `Appointed scrutiny officer: ${exam.course.code}`, body: `${exam.course.title} — ${exam.session.name}`, link: "/scrutiny" }, tx);
    }
    await audit(
      {
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        action: "exam.update",
        resourceType: "examination",
        resourceId: id,
        summary: `${exam.course.code} (${exam.session.code}) updated`,
        oldValue: { moderatorId: exam.moderatorId, scrutinizerId: exam.scrutinizerId, blueprintId: exam.blueprintId, schedule: exam.schedule?.date },
        newValue: v,
      },
      tx,
    );
  });
}
