import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { type AuthContext, can, isSuperAdmin } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { notify } from "@/server/services/notifications";

/**
 * Annual appraisal: HR opens a cycle with weighted criteria; each employee rates themselves, then the
 * reporting manager rates and comments. The score is the weighted average of the manager's ratings (1–5).
 */

const criterion = z.object({ key: z.string().regex(/^[a-z0-9_]{2,30}$/), label: z.string().trim().min(2).max(120), weight: z.number().positive().max(100) });
export const cycleSchema = z.object({
  name: z.string().trim().min(3).max(120),
  year: z.number().int().min(2000).max(2100),
  opensAt: z.coerce.date(),
  closesAt: z.coerce.date(),
  criteria: z.array(criterion).min(1).max(20),
}).refine((v) => v.closesAt > v.opensAt, { path: ["closesAt"], message: "Closing date must be after opening" });

export type Criterion = z.infer<typeof criterion>;

export function weightedScore(criteria: Criterion[], ratings: Record<string, number>): number {
  const total = criteria.reduce((a, c) => a + c.weight, 0);
  return Math.round((criteria.reduce((a, c) => a + c.weight * (ratings[c.key] ?? 0), 0) / total) * 100) / 100;
}

export async function createAppraisalCycle(ctx: AuthContext, raw: unknown) {
  if (!can(ctx, "appraisal.manage")) throw forbidden();
  const v = cycleSchema.parse(raw);
  const keys = v.criteria.map((c) => c.key);
  if (new Set(keys).size !== keys.length) throw invalid("Criteria keys must be unique.");
  return db.$transaction(async (tx) => {
    const cycle = await tx.appraisalCycle.create({ data: { ...v, criteria: v.criteria as Prisma.InputJsonValue } });
    const employees = await tx.employee.findMany({ where: { deletedAt: null, status: { in: ["ACTIVE", "ON_LEAVE"] } }, select: { id: true, reportingToId: true, userId: true } });
    await tx.appraisal.createMany({ data: employees.map((e) => ({ cycleId: cycle.id, employeeId: e.id, reviewerId: e.reportingToId })) });
    await notify({ userIds: employees.map((e) => e.userId).filter((x): x is string => !!x), type: "hr.appraisal", title: `${v.name} is open for self-review`, link: "/me/appraisal" }, tx);
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "hr.appraisal.cycle", resourceType: "appraisalCycle", resourceId: cycle.id, summary: `${v.name}: ${employees.length} employee(s)` }, tx);
    return cycle;
  });
}

const ratingsFor = (criteria: Criterion[]) => z.object(Object.fromEntries(criteria.map((c) => [c.key, z.number().int().min(1).max(5)])));

export async function submitSelfReview(ctx: AuthContext, appraisalId: string, raw: unknown) {
  const a = await db.appraisal.findUnique({ where: { id: appraisalId }, include: { cycle: true, reviewer: { select: { userId: true } } } });
  if (!a || a.employeeId !== ctx.subject.employeeId) throw notFound("Appraisal");
  if (a.status !== "SELF_REVIEW") throw workflowError("The self-review has already been submitted.");
  const now = new Date();
  if (now < a.cycle.opensAt || now > a.cycle.closesAt) throw workflowError("The appraisal window is closed.");
  const criteria = a.cycle.criteria as unknown as Criterion[];
  const v = z.object({ ratings: ratingsFor(criteria), comments: z.string().trim().min(10).max(4000) }).parse(raw);
  await db.$transaction(async (tx) => {
    await tx.appraisal.update({ where: { id: a.id }, data: { selfRatings: v.ratings, selfComments: v.comments, status: "MANAGER_REVIEW", submittedAt: now } });
    if (a.reviewer?.userId) await notify({ userIds: [a.reviewer.userId], type: "hr.appraisal", title: `Appraisal ready for your review`, link: "/me/appraisal" }, tx);
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "hr.appraisal.self", resourceType: "appraisal", resourceId: a.id, summary: a.cycle.name }, tx);
  });
}

/** The reporting manager (or HR with appraisal.manage when there is no manager) completes the review. */
export async function submitManagerReview(ctx: AuthContext, appraisalId: string, raw: unknown) {
  const a = await db.appraisal.findUnique({ where: { id: appraisalId }, include: { cycle: true, employee: { select: { userId: true } } } });
  if (!a) throw notFound("Appraisal");
  const isReviewer = !!a.reviewerId && a.reviewerId === ctx.subject.employeeId;
  const isHr = (!a.reviewerId && can(ctx, "appraisal.manage")) || isSuperAdmin(ctx);
  if (!isReviewer && !isHr) throw notFound("Appraisal");
  if (a.employee.userId === ctx.user.id) throw forbidden("You cannot review your own appraisal.");
  if (a.status !== "MANAGER_REVIEW") throw workflowError(a.status === "SELF_REVIEW" ? "The employee has not submitted the self-review yet." : "This appraisal is already complete.");
  const criteria = a.cycle.criteria as unknown as Criterion[];
  const v = z.object({ ratings: ratingsFor(criteria), comments: z.string().trim().min(10).max(4000) }).parse(raw);
  const score = weightedScore(criteria, v.ratings);
  await db.$transaction(async (tx) => {
    await tx.appraisal.update({ where: { id: a.id }, data: { ratings: v.ratings, comments: v.comments, score, status: "COMPLETED", completedAt: new Date() } });
    if (a.employee.userId) await notify({ userIds: [a.employee.userId], type: "hr.appraisal", title: `Your appraisal is complete`, link: "/me/appraisal" }, tx);
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "hr.appraisal.review", resourceType: "appraisal", resourceId: a.id, summary: `${a.cycle.name}: score ${score}` }, tx);
  });
  return { score };
}
