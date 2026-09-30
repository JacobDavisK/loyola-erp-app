import "server-only";
import { z } from "zod";
import { revaluationOutcome } from "@/lib/domain/valuation";
import { type AuthContext, can, isSuperAdmin } from "@/server/auth/current";
import { db } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { usersWithPermission } from "@/server/services/directory";
import { notify } from "@/server/services/notifications";
import { issueInvoice } from "@/server/services/finance-core";
import { reviseCourseResult } from "@/server/services/result-engine";
import { getSetting } from "@/server/services/settings";
import { valuationPolicy } from "@/server/services/valuation";

/**
 * Revaluation and retotalling of published results.
 *   Student request (within the window) → fee recorded → Controller starts it:
 *     retotalling: the exam cell re-adds the script and enters the recounted total
 *     revaluation: a fresh valuer (never an earlier one) values the script anonymously
 *   → comparison rule (minimum change) → a new result version if the marks change → student notified.
 * The original result stays in the history.
 */

const REVAL_ROUND_BASE = 10;

async function windowOpen(runPublishedAt: Date | null, sessionUntil: Date | null) {
  if (!runPublishedAt) return false;
  const { revaluationWindowDays } = await getSetting("examination");
  const until = sessionUntil ?? new Date(runPublishedAt.getTime() + revaluationWindowDays * 86_400_000);
  return new Date() <= until;
}

export async function requestRevaluation(ctx: AuthContext, courseResultId: string, raw: unknown) {
  const v = z.object({ type: z.enum(["RETOTALLING", "REVALUATION"]) }).parse(raw);
  const r = await db.courseResult.findUnique({ where: { id: courseResultId }, include: { run: { include: { session: true } }, course: { select: { code: true, departmentId: true } }, student: { select: { userId: true } } } });
  if (!r || !r.isCurrent || !r.publishedAt) throw notFound("Result");
  const self = ctx.subject.studentId === r.studentId && can(ctx, "revaluation.request");
  if (!self && !can(ctx, "revaluation.manage")) throw notFound("Result");
  if (!["PASS", "FAIL"].includes(r.status)) throw workflowError("Only graded results can be revalued.");
  if (!(await windowOpen(r.run.publishedAt, r.run.session.revaluationUntil))) throw workflowError("The revaluation window for this session has closed.");
  if (await db.revaluationRequest.findFirst({ where: { courseResultId, status: { in: ["REQUESTED", "FEE_PENDING", "IN_PROGRESS"] } } })) throw conflict("A request for this result is already in progress.");
  const exam = await db.examination.findFirst({ where: { sessionId: r.run.sessionId, courseId: r.courseId } });
  const script = exam ? await db.answerScript.findFirst({ where: { examinationId: exam.id, registration: { studentId: r.studentId } } }) : null;
  if (!script || script.absent || script.finalMarks === null) throw workflowError("There is no valued answer script for this result.");
  const settings = await getSetting("examination");
  const fee = v.type === "REVALUATION" ? settings.revaluationFee : settings.retotallingFee;
  const req = await db.$transaction(async (tx) => {
    const created = await tx.revaluationRequest.create({ data: { courseResultId, studentId: r.studentId, type: v.type, fee, status: fee > 0 ? "FEE_PENDING" : "REQUESTED", originalMarks: script.finalMarks } });
    if (fee > 0) {
      // Raise an invoice when a revaluation fee head exists; paying it moves the request to "ready" automatically.
      const head = await tx.feeHead.findFirst({ where: { category: "REVALUATION", isActive: true } });
      if (head) {
        await issueInvoice(tx, {
          studentId: r.studentId, dueDate: new Date(Date.now() + 7 * 86_400_000), sourceType: "revaluationRequest", sourceId: created.id,
          lines: [{ feeHeadId: head.id, description: `${v.type === "REVALUATION" ? "Revaluation" : "Retotalling"} fee — ${r.course.code}`, amount: Math.round(fee * 100) }],
        }, { id: ctx.user.id, name: ctx.user.name });
      }
    }
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "revaluation.request", resourceType: "student", resourceId: r.studentId, summary: `${r.course.code}: ${v.type.toLowerCase()} requested (fee ${fee})` }, tx);
    const managers = await usersWithPermission("revaluation.manage", undefined, tx);
    await notify({ userIds: managers, type: "revaluation.requested", title: `${v.type === "REVALUATION" ? "Revaluation" : "Retotalling"} request: ${r.course.code}`, link: "/results/revaluation", email: false }, tx);
    return created;
  });
  return req;
}

/** Record that the fee was received (or waived) — until the finance module is connected, the desk records it. */
export async function settleRevaluationFee(ctx: AuthContext, requestId: string, raw: unknown) {
  if (!can(ctx, "revaluation.manage")) throw forbidden();
  const v = z.object({ waived: z.boolean().default(false), reference: z.string().trim().min(3, "Enter the receipt number or waiver reference").max(80) }).parse(raw);
  const req = await db.revaluationRequest.findUnique({ where: { id: requestId } });
  if (!req) throw notFound("Request");
  if (req.status !== "FEE_PENDING") throw workflowError("The fee for this request is not pending.");
  await db.$transaction(async (tx) => {
    await tx.revaluationRequest.update({ where: { id: requestId }, data: { status: "REQUESTED", remarks: `${v.waived ? "Fee waived" : "Fee received"}: ${v.reference}` } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: v.waived ? "revaluation.fee.waive" : "revaluation.fee.receive", resourceType: "revaluationRequest", resourceId: requestId, summary: v.reference }, tx);
  });
}

export async function startRevaluation(ctx: AuthContext, requestId: string, raw: unknown) {
  if (!can(ctx, "revaluation.manage")) throw forbidden();
  const v = z.object({ valuerId: z.string().nullable().optional() }).parse(raw ?? {});
  const req = await db.revaluationRequest.findUnique({ where: { id: requestId }, include: { courseResult: { include: { run: true } } } });
  if (!req) throw notFound("Request");
  if (req.status !== "REQUESTED") throw workflowError(req.status === "FEE_PENDING" ? "Record the fee first." : "This request has already been started.");
  if (req.type === "REVALUATION") {
    if (!v.valuerId) throw invalid("Choose a valuer for the revaluation.");
    const script = await db.answerScript.findFirstOrThrow({ where: { examination: { sessionId: req.courseResult.run.sessionId, courseId: req.courseResult.courseId }, registration: { studentId: req.studentId } }, include: { valuations: true } });
    if (script.valuations.some((x) => x.valuerId === v.valuerId)) throw invalid("Revaluation must be done by a valuer who has not valued this script before.");
    if (!(await usersWithPermission("valuation.perform")).includes(v.valuerId)) throw invalid("The person is not a valuer.");
    const round = REVAL_ROUND_BASE + script.valuations.filter((x) => x.round >= REVAL_ROUND_BASE).length;
    await db.$transaction(async (tx) => {
      await tx.scriptValuation.create({ data: { scriptId: script.id, round, valuerId: v.valuerId! } });
      await tx.revaluationRequest.update({ where: { id: requestId }, data: { status: "IN_PROGRESS" } });
      await notify({ userIds: [v.valuerId!], type: "valuation.assigned", title: "A script has been assigned to you for revaluation", link: "/valuation" }, tx);
      await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "revaluation.start", resourceType: "revaluationRequest", resourceId: requestId, summary: `Round ${round} assigned` }, tx);
    });
  } else {
    await db.$transaction(async (tx) => {
      await tx.revaluationRequest.update({ where: { id: requestId }, data: { status: "IN_PROGRESS" } });
      await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "revaluation.start", resourceType: "revaluationRequest", resourceId: requestId, summary: "Retotalling started" }, tx);
    });
  }
}

/** Revaluation valuer submits marks for their assigned script (dummy number only). */
export async function submitRevaluationMarks(ctx: AuthContext, valuationId: string, raw: unknown) {
  const v = z.object({ marks: z.number().min(0), remarks: z.string().trim().max(500).optional() }).parse(raw);
  const val = await db.scriptValuation.findUnique({ where: { id: valuationId }, include: { script: { include: { examination: { select: { maxMarks: true } } } } } });
  if (!val || (val.valuerId !== ctx.user.id && !isSuperAdmin(ctx)) || val.round < REVAL_ROUND_BASE) throw notFound("Valuation");
  if (val.submittedAt) throw workflowError("Already submitted.");
  if (v.marks > val.script.examination.maxMarks) throw invalid(`Marks cannot exceed ${val.script.examination.maxMarks}.`);
  await db.scriptValuation.update({ where: { id: valuationId }, data: { marks: v.marks, remarks: v.remarks ?? null, submittedAt: new Date() } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "revaluation.valuation.submit", resourceType: "answerScript", resourceId: val.scriptId, summary: `Revaluation marks ${v.marks}` });
}

/**
 * Apply the outcome. For revaluation the latest revaluation marks are compared with the original
 * under the configured rule; for retotalling the desk enters the recounted total.
 */
export async function completeRevaluation(ctx: AuthContext, requestId: string, raw: unknown) {
  if (!can(ctx, "revaluation.manage")) throw forbidden();
  const v = z.object({ recountedMarks: z.number().min(0).nullable().optional(), remarks: z.string().trim().max(500).optional() }).parse(raw ?? {});
  const req = await db.revaluationRequest.findUnique({ where: { id: requestId }, include: { courseResult: { include: { run: true, course: { select: { code: true, externalMarks: true } } } }, student: { select: { userId: true } } } });
  if (!req) throw notFound("Request");
  if (req.status !== "IN_PROGRESS") throw workflowError("Start the request first.");
  const script = await db.answerScript.findFirstOrThrow({ where: { examination: { sessionId: req.courseResult.run.sessionId, courseId: req.courseResult.courseId }, registration: { studentId: req.studentId } }, include: { valuations: { orderBy: { round: "desc" } }, examination: { select: { maxMarks: true } } } });
  let newScriptMarks: number;
  if (req.type === "REVALUATION") {
    const rv = script.valuations.find((x) => x.round >= REVAL_ROUND_BASE);
    if (!rv?.submittedAt || rv.marks === null) throw workflowError("The revaluation valuer has not submitted marks yet.");
    newScriptMarks = rv.marks;
  } else {
    if (v.recountedMarks === null || v.recountedMarks === undefined) throw invalid("Enter the recounted total.");
    if (v.recountedMarks > script.examination.maxMarks) throw invalid(`Cannot exceed ${script.examination.maxMarks}.`);
    newScriptMarks = v.recountedMarks;
  }
  const original = req.originalMarks ?? script.finalMarks ?? 0;
  const policy = await valuationPolicy();
  // Retotalling corrects an addition error, so any difference applies; revaluation uses the threshold rule.
  const outcome = req.type === "RETOTALLING" ? { finalMarks: newScriptMarks, outcome: newScriptMarks === original ? "UNCHANGED" as const : newScriptMarks > original ? "INCREASED" as const : "DECREASED" as const } : revaluationOutcome(original, newScriptMarks, policy);
  const actor = { id: ctx.user.id, name: ctx.user.name };
  await db.$transaction(async (tx) => {
    if (outcome.outcome !== "UNCHANGED") {
      const scaled = Math.round((outcome.finalMarks / script.examination.maxMarks) * req.courseResult.course.externalMarks * 100) / 100;
      await reviseCourseResult(tx, req.courseResultId, { externalMarks: scaled }, `${req.type === "REVALUATION" ? "Revaluation" : "Retotalling"}: script marks ${original} → ${outcome.finalMarks}`, actor);
    }
    await tx.revaluationRequest.update({ where: { id: requestId }, data: { status: "COMPLETED", revisedMarks: outcome.finalMarks, outcome: outcome.outcome, completedAt: new Date(), decidedById: ctx.user.id, remarks: v.remarks ?? req.remarks } });
    await audit({ actorId: actor.id, actorName: actor.name, action: "revaluation.complete", resourceType: "student", resourceId: req.studentId, summary: `${req.courseResult.course.code}: ${outcome.outcome.toLowerCase()} (${original} → ${outcome.finalMarks})` }, tx);
    await notify({ userIds: [req.student.userId], type: "revaluation.completed", title: `${req.type === "REVALUATION" ? "Revaluation" : "Retotalling"} result: ${req.courseResult.course.code}`, body: outcome.outcome === "UNCHANGED" ? "Your marks are unchanged." : `Your marks were ${outcome.outcome.toLowerCase()}. The updated result is in your portal.`, link: "/portal/results" }, tx);
  });
  return outcome;
}

export async function rejectRevaluation(ctx: AuthContext, requestId: string, reason: string) {
  if (!can(ctx, "revaluation.manage")) throw forbidden();
  const req = await db.revaluationRequest.findUnique({ where: { id: requestId }, include: { student: { select: { userId: true } } } });
  if (!req) throw notFound("Request");
  if (!["REQUESTED", "FEE_PENDING"].includes(req.status)) throw workflowError("Only requests that have not started can be rejected.");
  if (String(reason ?? "").trim().length < 5) throw invalid("Give a reason.");
  await db.$transaction(async (tx) => {
    await tx.revaluationRequest.update({ where: { id: requestId }, data: { status: "REJECTED", remarks: reason, decidedById: ctx.user.id, completedAt: new Date() } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "revaluation.reject", resourceType: "revaluationRequest", resourceId: requestId, summary: reason }, tx);
    await notify({ userIds: [req.student.userId], type: "revaluation.rejected", title: "Revaluation request not accepted", body: reason, link: "/portal/results" }, tx);
  });
}
