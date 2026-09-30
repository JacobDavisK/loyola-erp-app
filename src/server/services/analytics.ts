import "server-only";
import { BLOOM_K, BLOOM_LABEL, DIFFICULTY_LABEL } from "@/lib/domain/labels";
import { examinationWhere, paperWhere, questionWhere } from "@/server/auth/access";
import type { AuthContext } from "@/server/auth/current";
import { db } from "@/server/db";
import { setterWorkload } from "@/server/services/dashboard";

const DAY = 86_400_000;

export async function analytics(ctx: AuthContext) {
  const qScope = { AND: [questionWhere(ctx), { status: { not: "RETIRED" as const } }] };
  const [exams, papers, assignments, moderations, questions, byDiff, byBloom, usages, workload] = await Promise.all([
    db.examination.findMany({ where: { AND: [examinationWhere(ctx), { session: { status: { notIn: ["ARCHIVED"] } } }] }, select: { id: true, papers: { where: { deletedAt: null }, select: { status: true } } } }),
    db.questionPaper.findMany({ where: paperWhere(ctx), select: { id: true, status: true, createdAt: true, submittedAt: true } }),
    db.setterAssignment.findMany({ where: { examination: examinationWhere(ctx), status: { notIn: ["CANCELLED"] } }, select: { createdAt: true, submittedAt: true, deadline: true, status: true } }),
    db.moderation.findMany({ where: { paper: paperWhere(ctx), startedAt: { not: null }, completedAt: { not: null } }, select: { startedAt: true, completedAt: true } }),
    db.question.findMany({ where: qScope, select: { createdAt: true, courseId: true, unit: { select: { number: true } } } }),
    db.question.groupBy({ by: ["difficulty"], where: qScope, _count: { _all: true } }),
    db.question.groupBy({ by: ["bloom"], where: qScope, _count: { _all: true } }),
    db.questionUsage.findMany({ where: { question: questionWhere(ctx) }, select: { questionId: true, sessionId: true } }),
    setterWorkload(ctx),
  ]);

  const done = exams.filter((e) => e.papers.some((p) => ["APPROVED", "LOCKED", "RELEASED", "ARCHIVED"].includes(p.status))).length;
  const submitted = assignments.filter((a) => a.submittedAt);
  const avgSubmitDays = submitted.length ? submitted.reduce((s, a) => s + (a.submittedAt!.getTime() - a.createdAt.getTime()), 0) / submitted.length / DAY : null;
  const avgModDays = moderations.length ? moderations.reduce((s, m) => s + (m.completedAt!.getTime() - m.startedAt!.getTime()), 0) / moderations.length / DAY : null;
  const sessionsPerQ = new Map<string, Set<string>>();
  for (const u of usages) sessionsPerQ.set(u.questionId, (sessionsPerQ.get(u.questionId) ?? new Set()).add(u.sessionId));
  const reused = [...sessionsPerQ.values()].filter((s) => s.size > 1).length;
  const reuseRate = sessionsPerQ.size ? (reused / sessionsPerQ.size) * 100 : 0;
  const now = Date.now();
  const overdue = assignments.filter((a) => ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "RETURNED"].includes(a.status) && a.deadline.getTime() < now).length;

  // Question bank growth — cumulative per month, last 12 months
  const months: { month: string; total: number; added: number }[] = [];
  const start = new Date();
  start.setDate(1);
  start.setMonth(start.getMonth() - 11);
  start.setHours(0, 0, 0, 0);
  let running = questions.filter((q) => q.createdAt < start).length;
  for (let i = 0; i < 12; i++) {
    const from = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const to = new Date(start.getFullYear(), start.getMonth() + i + 1, 1);
    const added = questions.filter((q) => q.createdAt >= from && q.createdAt < to).length;
    running += added;
    months.push({ month: from.toLocaleString("en-GB", { month: "short", year: "2-digit" }), total: running, added });
  }

  // Unit coverage heatmap (courses with questions)
  const courses = await db.course.findMany({ where: { id: { in: [...new Set(questions.map((q) => q.courseId))] } }, select: { id: true, code: true }, orderBy: { code: "asc" } });
  const coverage = courses.map((c) => {
    const units = [1, 2, 3, 4, 5].map((u) => questions.filter((q) => q.courseId === c.id && q.unit.number === u).length);
    return { course: c.code, units };
  });

  return {
    kpis: {
      completionRate: exams.length ? Math.round((done / exams.length) * 100) : 0,
      completed: done,
      totalExams: exams.length,
      avgSubmitDays,
      avgModDays,
      reuseRate: Math.round(reuseRate),
      questions: questions.length,
      overdue,
      papers: papers.length,
    },
    growth: months,
    difficulty: (["EASY", "MODERATE", "HARD"] as const).map((k) => ({ label: DIFFICULTY_LABEL[k], value: byDiff.find((d) => d.difficulty === k)?._count._all ?? 0 })),
    bloom: (["REMEMBER", "UNDERSTAND", "APPLY", "ANALYZE", "EVALUATE", "CREATE"] as const).map((k) => ({ label: `${BLOOM_K[k]} ${BLOOM_LABEL[k]}`, value: byBloom.find((d) => d.bloom === k)?._count._all ?? 0 })),
    coverage,
    workload: workload.slice(0, 10).map((w) => ({ name: w.name.replace(/^(Dr\.|Prof\.)\s*/, ""), completed: w.completed, pending: w.pending, overdue: w.overdue })),
  };
}
