import "server-only";
import type { PaperStatus } from "@/generated/prisma/enums";
import { PIPELINE } from "@/lib/domain/workflow";
import { examinationWhere, paperWhere } from "@/server/auth/access";
import type { AuthContext } from "@/server/auth/current";
import { db } from "@/server/db";

export async function activeSessions(ctx: AuthContext) {
  const sessions = await db.examinationSession.findMany({
    where: { status: { notIn: ["ARCHIVED", "PUBLISHED"] }, examinations: { some: examinationWhere(ctx) } },
    orderBy: { startDate: "asc" },
    include: { academicYear: { select: { label: true } } },
  });
  return Promise.all(
    sessions.map(async (s) => {
      const exams = await db.examination.findMany({
        where: { AND: [examinationWhere(ctx), { sessionId: s.id }] },
        select: { id: true, papers: { where: { deletedAt: null }, select: { status: true } }, assignments: { where: { status: { notIn: ["CANCELLED", "DECLINED"] } }, select: { id: true } } },
      });
      const statuses = exams.flatMap((e) => e.papers.map((p) => p.status));
      const count = (list: PaperStatus[]) => statuses.filter((x) => list.includes(x)).length;
      return {
        id: s.id,
        name: s.name,
        code: s.code,
        status: s.status,
        startDate: s.startDate,
        endDate: s.endDate,
        academicYear: s.academicYear.label,
        subjects: exams.length,
        assigned: exams.filter((e) => e.assignments.length > 0).length,
        inPreparation: count(["DRAFT", "REVISION_REQUIRED"]),
        awaitingSubmission: exams.filter((e) => e.assignments.length > 0 && e.papers.every((p) => p.status === "DRAFT")).length,
        submitted: count(["SUBMITTED", "RESUBMITTED"]),
        moderation: count(["UNDER_MODERATION"]),
        scrutiny: count(["UNDER_SCRUTINY"]),
        approval: count(["AWAITING_APPROVAL"]),
        approved: count(["APPROVED"]),
        locked: count(["LOCKED", "RELEASED"]),
        completed: count(["APPROVED", "LOCKED", "RELEASED", "ARCHIVED"]),
        deadlines: [
          { label: "Paper submission", date: s.settingDeadline },
          { label: "Moderation", date: s.moderationDeadline },
          { label: "Final scrutiny", date: s.scrutinyDeadline },
          { label: "Approval", date: s.approvalDeadline },
        ].filter((d): d is { label: string; date: Date } => !!d.date),
      };
    }),
  );
}

export async function pipelineCounts(ctx: AuthContext, sessionId?: string) {
  const rows = await db.questionPaper.groupBy({
    by: ["status"],
    where: { AND: [paperWhere(ctx), sessionId ? { examination: { sessionId } } : {}] },
    _count: { _all: true },
  });
  const byStatus = new Map(rows.map((r) => [r.status, r._count._all]));
  return PIPELINE.map((p) => ({ key: p.key, label: p.label, count: p.statuses.reduce((s, st) => s + (byStatus.get(st) ?? 0), 0) }));
}

export async function upcomingDeadlines(ctx: AuthContext, limit = 8) {
  const now = new Date();
  const assignments = await db.setterAssignment.findMany({
    where: {
      status: { in: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "RETURNED"] },
      examination: examinationWhere(ctx),
      deadline: { lte: new Date(now.getTime() + 30 * 86_400_000) },
    },
    orderBy: { deadline: "asc" },
    take: limit,
    include: { setter: { select: { name: true } }, examination: { include: { course: { select: { code: true, title: true } } } }, paper: { select: { id: true } } },
  });
  return assignments.map((a) => ({
    id: a.id,
    course: `${a.examination.course.code} — ${a.examination.course.title}`,
    setter: a.setter.name,
    deadline: a.deadline,
    status: a.status,
    overdue: a.deadline < now,
    paperId: a.paper?.id ?? null,
  }));
}

export async function setterWorkload(ctx: AuthContext) {
  const rows = await db.setterAssignment.findMany({
    where: { examination: examinationWhere(ctx), status: { notIn: ["CANCELLED", "DECLINED"] } },
    select: { setterId: true, status: true, deadline: true, setter: { select: { name: true, department: { select: { code: true } } } } },
  });
  const now = new Date();
  const map = new Map<string, { name: string; dept: string; assigned: number; completed: number; pending: number; overdue: number }>();
  for (const r of rows) {
    const e = map.get(r.setterId) ?? { name: r.setter.name, dept: r.setter.department?.code ?? "—", assigned: 0, completed: 0, pending: 0, overdue: 0 };
    e.assigned++;
    if (["SUBMITTED", "RESUBMITTED", "APPROVED"].includes(r.status)) e.completed++;
    else {
      e.pending++;
      if (r.deadline < now) e.overdue++;
    }
    map.set(r.setterId, e);
  }
  return [...map.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.overdue - a.overdue || b.pending - a.pending);
}

export async function recentActivity(ctx: AuthContext, limit = 10) {
  // Activity feed only lists workflow events on papers the user can see.
  const visible = await db.questionPaper.findMany({ where: paperWhere(ctx), select: { id: true, code: true } });
  const ids = visible.map((v) => v.id);
  const codes = new Map(visible.map((v) => [v.id, v.code]));
  const rows = await db.paperTransition.findMany({
    where: { paperId: { in: ids } },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { actor: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.id, paperId: r.paperId, paperCode: codes.get(r.paperId) ?? "", action: r.action, to: r.to, actor: r.actor.name, note: r.note, at: r.createdAt }));
}

export async function securityAlerts() {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const [failed, locked, recent] = await Promise.all([
    db.loginAttempt.count({ where: { success: false, createdAt: { gte: since } } }),
    db.user.count({ where: { lockedUntil: { gt: new Date() } } }),
    db.auditLog.findMany({
      where: { action: { in: ["auth.login.failed", "auth.account.locked", "auth.login.blocked", "auth.mfa.failed"] }, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);
  return { failed, locked, recent: recent.map((r) => ({ id: r.id.toString(), action: r.action, summary: r.summary, actor: r.actorName, ip: r.ip, at: r.createdAt })) };
}

export async function myAssignments(ctx: AuthContext) {
  return db.setterAssignment.findMany({
    where: { OR: [{ setterId: ctx.user.id }, { backupSetterId: ctx.user.id }], status: { notIn: ["CANCELLED"] } },
    orderBy: [{ deadline: "asc" }],
    include: {
      examination: { include: { course: { include: { program: { select: { code: true } }, semester: { select: { name: true } } } }, session: { select: { name: true, code: true } } } },
      paper: { select: { id: true, status: true, revision: true, versionMajor: true, versionMinor: true, _count: { select: { comments: { where: { resolved: false } } } } } },
      assignedBy: { select: { name: true } },
    },
  });
}

export async function reviewQueue(ctx: AuthContext, kind: "moderation" | "scrutiny" | "approval") {
  const where =
    kind === "moderation"
      ? { examination: { moderatorId: ctx.user.id }, status: { in: ["SUBMITTED", "RESUBMITTED", "UNDER_MODERATION"] as PaperStatus[] } }
      : kind === "scrutiny"
        ? { examination: { scrutinizerId: ctx.user.id }, status: "UNDER_SCRUTINY" as PaperStatus }
        : { AND: [paperWhere(ctx), { status: "AWAITING_APPROVAL" as PaperStatus }] };
  return db.questionPaper.findMany({
    where: { deletedAt: null, ...where },
    orderBy: { updatedAt: "asc" },
    include: {
      examination: { include: { course: { select: { code: true, title: true } }, session: { select: { name: true, moderationDeadline: true, scrutinyDeadline: true, approvalDeadline: true } } } },
      setter: { select: { name: true } },
    },
  });
}
