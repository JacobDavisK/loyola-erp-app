import "server-only";
import { BLOOM_LABEL, DIFFICULTY_LABEL, PAPER_STATUS } from "@/lib/domain/labels";
import { examinationWhere, questionWhere } from "@/server/auth/access";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden } from "@/server/errors";

export type ReportKind = "examination" | "setters" | "question-bank" | "moderation" | "audit";

export interface ReportColumn {
  key: string;
  label: string;
  align?: "left" | "right";
}

export interface ReportTable {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, string | number>[];
}

export interface Report {
  kind: ReportKind;
  title: string;
  subtitle: string;
  summary: { label: string; value: string | number }[];
  tables: ReportTable[];
}

export const REPORT_KINDS: { key: ReportKind; label: string; perm: "report.view" | "audit.view" }[] = [
  { key: "examination", label: "Examination status", perm: "report.view" },
  { key: "setters", label: "Setter report", perm: "report.view" },
  { key: "question-bank", label: "Question bank", perm: "report.view" },
  { key: "moderation", label: "Moderation", perm: "report.view" },
  { key: "audit", label: "Audit & access", perm: "audit.view" },
];

export async function buildReport(ctx: AuthContext, kind: ReportKind, opts: { sessionId?: string } = {}): Promise<Report> {
  const def = REPORT_KINDS.find((k) => k.key === kind);
  if (!def || !can(ctx, def.perm)) throw forbidden();
  const sessions = await db.examinationSession.findMany({ orderBy: { startDate: "desc" }, select: { id: true, name: true, status: true } });
  // Default: the earliest session with work in progress (not one still being planned).
  const active = sessions.filter((s) => ["OPEN", "PAPER_SETTING", "MODERATION", "SCRUTINY", "APPROVAL", "LOCKED"].includes(s.status));
  const session = sessions.find((s) => s.id === opts.sessionId) ?? active.at(-1) ?? sessions.find((s) => !["ARCHIVED", "PUBLISHED"].includes(s.status)) ?? sessions[0];
  const examScope = { AND: [examinationWhere(ctx), session ? { sessionId: session.id } : {}] };
  const subtitle = session ? session.name : "All sessions";

  switch (kind) {
    case "examination": {
      const exams = await db.examination.findMany({
        where: examScope,
        orderBy: { course: { code: "asc" } },
        include: {
          course: { include: { department: { select: { code: true } } } },
          assignments: { where: { status: { notIn: ["CANCELLED", "DECLINED"] } }, select: { status: true } },
          papers: { where: { deletedAt: null }, select: { status: true } },
        },
      });
      const statusOf = (e: (typeof exams)[number]) => e.papers[0]?.status;
      const count = (fn: (e: (typeof exams)[number]) => boolean) => exams.filter(fn).length;
      const byDept = new Map<string, { total: number; assigned: number; submitted: number; moderated: number; approved: number }>();
      for (const e of exams) {
        const d = byDept.get(e.course.department.code) ?? { total: 0, assigned: 0, submitted: 0, moderated: 0, approved: 0 };
        const st = statusOf(e);
        d.total++;
        if (e.assignments.length) d.assigned++;
        if (st && st !== "DRAFT") d.submitted++;
        if (st && ["UNDER_SCRUTINY", "AWAITING_APPROVAL", "APPROVED", "LOCKED", "RELEASED", "ARCHIVED"].includes(st)) d.moderated++;
        if (st && ["APPROVED", "LOCKED", "RELEASED", "ARCHIVED"].includes(st)) d.approved++;
        byDept.set(e.course.department.code, d);
      }
      return {
        kind,
        title: "Examination status report",
        subtitle,
        summary: [
          { label: "Total subjects", value: exams.length },
          { label: "Papers assigned", value: count((e) => e.assignments.length > 0) },
          { label: "Papers submitted", value: count((e) => !!statusOf(e) && statusOf(e) !== "DRAFT") },
          { label: "Papers pending", value: count((e) => !statusOf(e) || ["DRAFT", "REVISION_REQUIRED"].includes(statusOf(e)!)) },
          { label: "Papers moderated", value: count((e) => ["UNDER_SCRUTINY", "AWAITING_APPROVAL", "APPROVED", "LOCKED", "RELEASED", "ARCHIVED"].includes(statusOf(e) ?? "")) },
          { label: "Papers approved", value: count((e) => ["APPROVED", "LOCKED", "RELEASED", "ARCHIVED"].includes(statusOf(e) ?? "")) },
        ],
        tables: [
          {
            title: "By department",
            columns: [{ key: "dept", label: "Department" }, { key: "total", label: "Subjects", align: "right" }, { key: "assigned", label: "Assigned", align: "right" }, { key: "submitted", label: "Submitted", align: "right" }, { key: "moderated", label: "Moderated", align: "right" }, { key: "approved", label: "Approved", align: "right" }],
            rows: [...byDept.entries()].map(([dept, v]) => ({ dept, ...v })),
          },
          {
            title: "By examination",
            columns: [{ key: "code", label: "Course" }, { key: "title", label: "Title" }, { key: "dept", label: "Dept" }, { key: "setters", label: "Setters", align: "right" }, { key: "status", label: "Paper status" }],
            rows: exams.map((e) => ({ code: e.course.code, title: e.course.title, dept: e.course.department.code, setters: e.assignments.length, status: statusOf(e) ? PAPER_STATUS[statusOf(e)!].label : "Not started" })),
          },
        ],
      };
    }
    case "setters": {
      const rows = await db.setterAssignment.findMany({ where: { examination: examScope, status: { notIn: ["CANCELLED"] } }, include: { setter: { select: { name: true, department: { select: { code: true } } } } } });
      const now = new Date();
      const m = new Map<string, { setter: string; dept: string; assigned: number; completed: number; pending: number; overdue: number; declined: number }>();
      for (const a of rows) {
        const e = m.get(a.setterId) ?? { setter: a.setter.name, dept: a.setter.department?.code ?? "—", assigned: 0, completed: 0, pending: 0, overdue: 0, declined: 0 };
        e.assigned++;
        if (a.status === "DECLINED") e.declined++;
        else if (["SUBMITTED", "RESUBMITTED", "APPROVED"].includes(a.status)) e.completed++;
        else {
          e.pending++;
          if (a.deadline < now) e.overdue++;
        }
        m.set(a.setterId, e);
      }
      const list = [...m.values()].sort((a, b) => b.overdue - a.overdue || a.setter.localeCompare(b.setter));
      return {
        kind,
        title: "Setter report",
        subtitle,
        summary: [
          { label: "Setters", value: list.length },
          { label: "Assignments", value: rows.length },
          { label: "Completed", value: list.reduce((s, x) => s + x.completed, 0) },
          { label: "Overdue", value: list.reduce((s, x) => s + x.overdue, 0) },
        ],
        tables: [
          {
            title: "Setters",
            columns: [{ key: "setter", label: "Setter" }, { key: "dept", label: "Dept" }, { key: "assigned", label: "Assigned", align: "right" }, { key: "completed", label: "Completed", align: "right" }, { key: "pending", label: "Pending", align: "right" }, { key: "overdue", label: "Overdue", align: "right" }, { key: "declined", label: "Declined", align: "right" }],
            rows: list,
          },
        ],
      };
    }
    case "question-bank": {
      const scope = { AND: [questionWhere(ctx), { status: { not: "RETIRED" as const } }] };
      const [byCourse, byDiff, byBloom, most, never, total] = await Promise.all([
        db.question.groupBy({ by: ["courseId"], where: scope, _count: { _all: true } }),
        db.question.groupBy({ by: ["difficulty"], where: scope, _count: { _all: true } }),
        db.question.groupBy({ by: ["bloom"], where: scope, _count: { _all: true } }),
        db.question.findMany({ where: { AND: [scope, { usageCount: { gt: 0 } }] }, orderBy: { usageCount: "desc" }, take: 15, include: { course: { select: { code: true } } } }),
        db.question.count({ where: { AND: [scope, { usageCount: 0 }] } }),
        db.question.count({ where: scope }),
      ]);
      const courses = await db.course.findMany({ where: { id: { in: byCourse.map((c) => c.courseId) } }, select: { id: true, code: true, title: true } });
      const byUnit = await db.$queryRaw<{ code: string; unit: number; n: bigint }[]>`
        SELECT c.code, u.number AS unit, COUNT(q.id) AS n FROM "Question" q
        JOIN "CourseUnit" u ON u.id = q."unitId" JOIN "Course" c ON c.id = q."courseId"
        WHERE q."deletedAt" IS NULL AND q.status <> 'RETIRED'
        GROUP BY c.code, u.number ORDER BY c.code, u.number`;
      const allowedCourses = new Set(courses.map((c) => c.code));
      return {
        kind,
        title: "Question bank report",
        subtitle: "Questions in your scope",
        summary: [
          { label: "Questions", value: total },
          { label: "Courses", value: byCourse.length },
          { label: "Never used", value: never },
          { label: "Used at least once", value: total - never },
        ],
        tables: [
          { title: "Questions by course", columns: [{ key: "code", label: "Course" }, { key: "title", label: "Title" }, { key: "n", label: "Questions", align: "right" }], rows: byCourse.map((b) => { const c = courses.find((x) => x.id === b.courseId)!; return { code: c.code, title: c.title, n: b._count._all }; }).sort((a, b) => a.code.localeCompare(b.code)) },
          { title: "Questions by difficulty", columns: [{ key: "k", label: "Difficulty" }, { key: "n", label: "Questions", align: "right" }], rows: byDiff.map((d) => ({ k: DIFFICULTY_LABEL[d.difficulty], n: d._count._all })) },
          { title: "Questions by Bloom level", columns: [{ key: "k", label: "Bloom level" }, { key: "n", label: "Questions", align: "right" }], rows: byBloom.map((d) => ({ k: BLOOM_LABEL[d.bloom], n: d._count._all })) },
          { title: "Questions by unit", columns: [{ key: "code", label: "Course" }, { key: "unit", label: "Unit", align: "right" }, { key: "n", label: "Questions", align: "right" }], rows: byUnit.filter((r) => allowedCourses.has(r.code)).map((r) => ({ code: r.code, unit: r.unit, n: Number(r.n) })) },
          { title: "Most used questions", columns: [{ key: "code", label: "Question" }, { key: "course", label: "Course" }, { key: "text", label: "Text" }, { key: "n", label: "Uses", align: "right" }], rows: most.map((q) => ({ code: q.code, course: q.course.code, text: q.plainText.slice(0, 90), n: q.usageCount })) },
        ],
      };
    }
    case "moderation": {
      const mods = await db.moderation.findMany({ where: { paper: { examination: examScope, deletedAt: null } }, include: { moderator: { select: { name: true } }, paper: { select: { code: true, revisionCount: true } } } });
      const papers = await db.questionPaper.findMany({ where: { examination: examScope, deletedAt: null, submittedAt: { not: null } }, select: { revisionCount: true } });
      const done = mods.filter((m) => m.completedAt && m.startedAt);
      const avgDays = done.length ? done.reduce((s, m) => s + (m.completedAt!.getTime() - m.startedAt!.getTime()), 0) / done.length / 86_400_000 : 0;
      const byMod = new Map<string, { moderator: string; reviews: number; approved: number; returned: number; rejected: number; pending: number }>();
      for (const m of mods) {
        const e = byMod.get(m.moderatorId) ?? { moderator: m.moderator.name, reviews: 0, approved: 0, returned: 0, rejected: 0, pending: 0 };
        e.reviews++;
        if (m.status === "APPROVED") e.approved++;
        else if (m.status === "CHANGES_REQUESTED") e.returned++;
        else if (m.status === "REJECTED") e.rejected++;
        else e.pending++;
        byMod.set(m.moderatorId, e);
      }
      return {
        kind,
        title: "Moderation report",
        subtitle,
        summary: [
          { label: "Approved", value: mods.filter((m) => m.status === "APPROVED").length },
          { label: "Returned", value: mods.filter((m) => m.status === "CHANGES_REQUESTED").length },
          { label: "Rejected", value: mods.filter((m) => m.status === "REJECTED").length },
          { label: "Average revision count", value: papers.length ? (papers.reduce((s, p) => s + p.revisionCount, 0) / papers.length).toFixed(2) : "0" },
          { label: "Avg. turnaround (days)", value: avgDays.toFixed(1) },
        ],
        tables: [
          { title: "By moderator", columns: [{ key: "moderator", label: "Moderator" }, { key: "reviews", label: "Reviews", align: "right" }, { key: "approved", label: "Approved", align: "right" }, { key: "returned", label: "Returned", align: "right" }, { key: "rejected", label: "Rejected", align: "right" }, { key: "pending", label: "Pending", align: "right" }], rows: [...byMod.values()] },
          { title: "Moderation rounds", columns: [{ key: "paper", label: "Paper" }, { key: "round", label: "Round", align: "right" }, { key: "moderator", label: "Moderator" }, { key: "status", label: "Outcome" }, { key: "summary", label: "Remarks" }], rows: mods.map((m) => ({ paper: m.paper.code, round: m.round, moderator: m.moderator.name, status: m.status.replace("_", " ").toLowerCase(), summary: (m.summary ?? "").slice(0, 100) })) },
        ],
      };
    }
    case "audit": {
      const since = new Date(Date.now() - 30 * 86_400_000);
      const [byUser, downloads, exports, access] = await Promise.all([
        db.auditLog.groupBy({ by: ["actorName"], where: { createdAt: { gte: since }, actorName: { not: null } }, _count: { _all: true }, orderBy: { _count: { actorName: "desc" } }, take: 25 }),
        db.auditLog.findMany({ where: { createdAt: { gte: since }, action: { startsWith: "file.download" } }, orderBy: { id: "desc" }, take: 100 }),
        db.auditLog.findMany({ where: { createdAt: { gte: since }, OR: [{ action: { startsWith: "paper.export" } }, { action: "paper.package" }] }, orderBy: { id: "desc" }, take: 200 }),
        db.auditLog.findMany({ where: { createdAt: { gte: since }, action: { in: ["paper.preview", "paper.access"] } }, orderBy: { id: "desc" }, take: 200 }),
      ]);
      const fmt = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");
      return {
        kind,
        title: "Audit & access report",
        subtitle: "Last 30 days",
        summary: [
          { label: "Active users", value: byUser.length },
          { label: "Exports", value: exports.length },
          { label: "Downloads", value: downloads.length },
          { label: "Paper accesses", value: access.length },
        ],
        tables: [
          { title: "User activity", columns: [{ key: "user", label: "User" }, { key: "n", label: "Events", align: "right" }], rows: byUser.map((u) => ({ user: u.actorName ?? "—", n: u._count._all })) },
          { title: "Exports", columns: [{ key: "at", label: "When" }, { key: "user", label: "User" }, { key: "action", label: "Action" }, { key: "summary", label: "Detail" }, { key: "ip", label: "IP" }], rows: exports.map((e) => ({ at: fmt(e.createdAt), user: e.actorName ?? "—", action: e.action, summary: e.summary ?? "", ip: e.ip ?? "" })) },
          { title: "Downloads", columns: [{ key: "at", label: "When" }, { key: "user", label: "User" }, { key: "summary", label: "File" }, { key: "ip", label: "IP" }], rows: downloads.map((e) => ({ at: fmt(e.createdAt), user: e.actorName ?? "—", summary: e.summary ?? "", ip: e.ip ?? "" })) },
          { title: "Paper access", columns: [{ key: "at", label: "When" }, { key: "user", label: "User" }, { key: "summary", label: "Detail" }], rows: access.map((e) => ({ at: fmt(e.createdAt), user: e.actorName ?? "—", summary: e.summary ?? "" })) },
        ],
      };
    }
  }
}
