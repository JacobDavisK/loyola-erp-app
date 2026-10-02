import "server-only";
import { weakOutcomes, type OutcomeScore } from "@/lib/domain/success";
import { type AuthContext } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, invalid, notFound } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { currentTerm } from "@/server/services/academic-setup";
import { teacherOf } from "@/server/services/lms";

/**
 * Personalised learning recommendations, built on outcome-based education: a student's score per course
 * outcome comes from quiz questions tagged with that outcome and from assessment components mapped to it.
 * For outcomes below 50%, the course material tagged with the same outcome is recommended, unread first.
 * Nothing is inferred beyond the student's own marks in their own classes.
 */

export async function setItemOutcomes(ctx: AuthContext, itemId: string, outcomeIds: string[]) {
  const item = await db.learningItem.findUnique({ where: { id: itemId }, include: { module: { select: { offeringId: true, offering: { select: { courseId: true } } } } } });
  if (!item) throw notFound("Item");
  await teacherOf(ctx, item.module.offeringId);
  const valid = new Set((await db.learningOutcome.findMany({ where: { courseId: item.module.offering.courseId }, select: { id: true } })).map((o) => o.id));
  const ids = [...new Set(outcomeIds)];
  if (ids.some((x) => !valid.has(x))) throw invalid("Choose outcomes of this course.");
  await db.$transaction(async (tx) => {
    await tx.learningItemOutcome.deleteMany({ where: { itemId } });
    if (ids.length) await tx.learningItemOutcome.createMany({ data: ids.map((outcomeId) => ({ itemId, outcomeId })) });
  });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "lms.item.outcomes", resourceType: "learningItem", resourceId: itemId, summary: `${item.title}: ${ids.length} outcome(s)` });
}

/** Per-outcome scores of one student in one class. */
export async function outcomeScores(studentId: string, offeringId: string): Promise<OutcomeScore[]> {
  const [attempts, comps] = await Promise.all([
    db.quizAttempt.findMany({ where: { studentId, quiz: { offeringId }, status: "SUBMITTED" }, select: { marksAwarded: true, quiz: { select: { questions: { where: { outcomeId: { not: null } }, select: { id: true, outcomeId: true, marks: true } } } } } }),
    db.assessmentComponent.findMany({ where: { offeringId, outcomes: { some: {} } }, select: { maxMarks: true, outcomes: { select: { outcomeId: true } }, marks: { where: { studentId }, select: { marks: true, status: true } } } }),
  ]);
  const out: OutcomeScore[] = [];
  for (const a of attempts) {
    const awarded = (a.marksAwarded ?? {}) as Record<string, number>;
    for (const q of a.quiz.questions) out.push({ outcomeId: q.outcomeId!, earned: awarded[q.id] ?? 0, max: q.marks });
  }
  for (const c of comps) {
    const m = c.marks[0];
    if (!m || m.marks === null) continue; // not marked yet
    for (const o of c.outcomes) out.push({ outcomeId: o.outcomeId, earned: m.status === "PRESENT" ? m.marks : 0, max: c.maxMarks });
  }
  return out;
}

export async function recommendationsFor(ctx: AuthContext, studentId: string) {
  if (ctx.subject.studentId !== studentId) throw forbidden();
  const term = await currentTerm();
  if (!term) return [];
  const regs = await db.courseRegistration.findMany({ where: { studentId, status: "REGISTERED", offering: { termId: term.id } }, select: { offering: { select: { id: true, course: { select: { code: true, title: true } } } } } });
  const result = [];
  for (const r of regs) {
    const weak = weakOutcomes(await outcomeScores(studentId, r.offering.id));
    if (!weak.length) continue;
    const ids = weak.map((w) => w.outcomeId);
    const [outcomes, items] = await Promise.all([
      db.learningOutcome.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, description: true } }),
      db.learningItem.findMany({
        where: { isPublished: true, module: { offeringId: r.offering.id, isPublished: true }, outcomes: { some: { outcomeId: { in: ids } } }, OR: [{ availableFrom: null }, { availableFrom: { lte: new Date() } }] },
        select: { id: true, title: true, kind: true, outcomes: { select: { outcomeId: true } }, views: { where: { studentId }, select: { lastViewedAt: true } } },
        take: 20,
      }),
    ]);
    result.push({
      offering: r.offering,
      weak: weak.map((w) => ({ ...w, ...outcomes.find((o) => o.id === w.outcomeId)! })),
      items: items
        .map((i) => ({ id: i.id, title: i.title, kind: i.kind, viewed: i.views.length > 0, outcomeCodes: i.outcomes.map((o) => outcomes.find((x) => x.id === o.outcomeId)?.code).filter(Boolean) as string[] }))
        .sort((a, b) => Number(a.viewed) - Number(b.viewed)),
    });
  }
  return result;
}
