import "server-only";
import { z } from "zod";
import { valuationState, type ValuationPolicy } from "@/lib/domain/valuation";
import { type AuthContext, can, isSuperAdmin } from "@/server/auth/current";
import { db, type Tx } from "@/server/db";
import { forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { usersWithPermission } from "@/server/services/directory";
import { notify } from "@/server/services/notifications";
import { getSetting } from "@/server/services/settings";

export async function valuationPolicy(): Promise<ValuationPolicy> {
  const e = await getSetting("examination");
  return { doubleValuation: e.doubleValuation, maxDifferencePercent: e.valuationMaxDifferencePercent, method: e.valuationMethod, revaluationMinChange: e.revaluationMinChange };
}

const needManage = (ctx: AuthContext) => {
  if (!can(ctx, "valuation.manage")) throw forbidden();
};

async function examinationUnpublished(examinationId: string) {
  const exam = await db.examination.findUnique({ where: { id: examinationId }, include: { course: { select: { code: true, programId: true } } } });
  if (!exam) throw notFound("Examination");
  const published = await db.resultRun.count({ where: { sessionId: exam.sessionId, status: "PUBLISHED", OR: [{ programId: null }, { programId: exam.course.programId }] } });
  if (published) throw workflowError("Results for this examination are published. Changes go through revaluation.");
  return exam;
}

/** Create an answer-script record for every confirmed candidate (identified by dummy number only). */
export async function codeScripts(ctx: AuthContext, examinationId: string) {
  needManage(ctx);
  const exam = await examinationUnpublished(examinationId);
  const regs = await db.examRegistration.findMany({ where: { examinationId, status: "REGISTERED", script: null } });
  if (regs.length) await db.answerScript.createMany({ data: regs.map((r) => ({ registrationId: r.id, examinationId })) });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "valuation.scripts.code", resourceType: "examination", resourceId: examinationId, summary: `${exam.course.code}: ${regs.length} script(s) coded` });
  return { created: regs.length };
}

/** Record exam-day absence or malpractice. Absent scripts need no valuation. */
export async function setScriptAttendance(ctx: AuthContext, scriptId: string, raw: unknown) {
  needManage(ctx);
  const v = z.object({ absent: z.boolean(), malpractice: z.boolean().default(false), reason: z.string().trim().max(300).optional() }).parse(raw);
  const s = await db.answerScript.findUnique({ where: { id: scriptId }, include: { registration: { select: { dummyNo: true } } } });
  if (!s) throw notFound("Script");
  await examinationUnpublished(s.examinationId);
  await db.$transaction(async (tx) => {
    await tx.answerScript.update({ where: { id: scriptId }, data: v.absent ? { absent: true, malpractice: false, status: "FINAL", finalMarks: null, finalizedAt: new Date() } : { absent: false, malpractice: v.malpractice, status: s.absent ? "PENDING" : s.status } });
    if (v.absent) await tx.scriptValuation.deleteMany({ where: { scriptId, submittedAt: null } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "valuation.script.attendance", resourceType: "answerScript", resourceId: scriptId, summary: `${s.registration.dummyNo}: ${v.absent ? "absent" : v.malpractice ? "malpractice" : "present"}${v.reason ? ` — ${v.reason}` : ""}` }, tx);
  });
}

/**
 * Distribute scripts to valuers for a round, round-robin. A valuer never gets a script they valued in
 * another round. Round 2 exists only with double valuation; round 3 only for scripts that need it.
 */
export async function assignValuers(ctx: AuthContext, examinationId: string, raw: unknown) {
  needManage(ctx);
  const v = z.object({ round: z.union([z.literal(1), z.literal(2), z.literal(3)]), valuerIds: z.array(z.string()).min(1).max(50) }).parse(raw);
  const exam = await examinationUnpublished(examinationId);
  const policy = await valuationPolicy();
  if (v.round === 2 && !policy.doubleValuation) throw invalid("Double valuation is switched off in the examination settings.");
  const eligible = new Set(await usersWithPermission("valuation.perform"));
  const bad = v.valuerIds.filter((id) => !eligible.has(id));
  if (bad.length) throw invalid("Every valuer must hold the Valuer or External Examiner role.");
  const scripts = await db.answerScript.findMany({
    where: { examinationId, absent: false, ...(v.round === 3 ? { status: "THIRD_VALUATION" } : { status: { in: ["PENDING", "IN_VALUATION"] } }), valuations: { none: { round: v.round } } },
    include: { valuations: { select: { valuerId: true } } },
    orderBy: { id: "asc" },
  });
  if (!scripts.length) throw invalid(`No scripts are waiting for round ${v.round}.`);
  let i = 0;
  const assigned: { scriptId: string; valuerId: string }[] = [];
  for (const s of scripts) {
    const taken = new Set(s.valuations.map((x) => x.valuerId));
    const pick = v.valuerIds.map((_, k) => v.valuerIds[(i + k) % v.valuerIds.length]).find((id) => !taken.has(id));
    i++;
    if (!pick) continue;
    assigned.push({ scriptId: s.id, valuerId: pick });
  }
  await db.$transaction(async (tx) => {
    await tx.scriptValuation.createMany({ data: assigned.map((a) => ({ ...a, round: v.round })) });
    await tx.answerScript.updateMany({ where: { id: { in: assigned.map((a) => a.scriptId) }, status: "PENDING" }, data: { status: "IN_VALUATION" } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "valuation.assign", resourceType: "examination", resourceId: examinationId, summary: `${exam.course.code} round ${v.round}: ${assigned.length} script(s) to ${new Set(assigned.map((a) => a.valuerId)).size} valuer(s)` }, tx);
    const counts = new Map<string, number>();
    for (const a of assigned) counts.set(a.valuerId, (counts.get(a.valuerId) ?? 0) + 1);
    for (const [uid, n] of counts) await notify({ userIds: [uid], type: "valuation.assigned", title: `${n} answer script(s) to value`, body: `${exam.course.code} · round ${v.round}`, link: "/valuation" }, tx);
  });
  return { assigned: assigned.length, skipped: scripts.length - assigned.length };
}

/** A valuer's queue: dummy numbers, course and maximum marks only — never student identity. */
export async function myValuations(ctx: AuthContext) {
  if (!can(ctx, "valuation.perform")) throw forbidden();
  const rows = await db.scriptValuation.findMany({
    where: { valuerId: ctx.user.id },
    orderBy: [{ submittedAt: { sort: "desc", nulls: "first" } }, { assignedAt: "asc" }],
    take: 500,
    select: {
      id: true, round: true, marks: true, remarks: true, submittedAt: true, assignedAt: true,
      script: { select: { registration: { select: { dummyNo: true } }, examination: { select: { maxMarks: true, course: { select: { code: true, title: true } }, session: { select: { name: true } } } } } },
    },
  });
  return rows;
}

async function settle(tx: Tx, scriptId: string, policy: ValuationPolicy) {
  const s = await tx.answerScript.findUniqueOrThrow({ where: { id: scriptId }, include: { valuations: true, examination: { select: { maxMarks: true } } } });
  const state = valuationState(s.valuations.filter((v) => v.round <= 3 && v.submittedAt).map((v) => ({ round: v.round, marks: v.marks })), s.examination.maxMarks, policy);
  if (state.kind === "FINAL") await tx.answerScript.update({ where: { id: scriptId }, data: { status: "FINAL", finalMarks: state.marks, finalizedAt: new Date() } });
  else if (state.kind === "THIRD_NEEDED") await tx.answerScript.update({ where: { id: scriptId }, data: { status: "THIRD_VALUATION" } });
  else await tx.answerScript.update({ where: { id: scriptId }, data: { status: state.next === 2 ? "VALUED" : "IN_VALUATION" } });
  return state;
}

export async function submitValuation(ctx: AuthContext, valuationId: string, raw: unknown) {
  const v = z.object({ marks: z.number().min(0), remarks: z.string().trim().max(500).optional() }).parse(raw);
  const val = await db.scriptValuation.findUnique({ where: { id: valuationId }, include: { script: { include: { examination: { select: { maxMarks: true, id: true } } } } } });
  if (!val || (val.valuerId !== ctx.user.id && !isSuperAdmin(ctx))) throw notFound("Valuation");
  if (val.submittedAt) throw workflowError("This valuation was already submitted.");
  if (val.round >= 10) throw workflowError("Revaluation marks are submitted through the revaluation desk.");
  if (v.marks > val.script.examination.maxMarks) throw invalid(`Marks cannot exceed ${val.script.examination.maxMarks}.`);
  await examinationUnpublished(val.script.examination.id);
  const policy = await valuationPolicy();
  return db.$transaction(async (tx) => {
    await tx.scriptValuation.update({ where: { id: valuationId }, data: { marks: v.marks, remarks: v.remarks ?? null, submittedAt: new Date() } });
    const state = await settle(tx, val.scriptId, policy);
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "valuation.submit", resourceType: "answerScript", resourceId: val.scriptId, summary: `Round ${val.round}: ${v.marks}${state.kind === "FINAL" ? ` → final ${state.marks}` : state.kind === "THIRD_NEEDED" ? " → third valuation needed" : ""}` }, tx);
    return state;
  });
}

/** Progress of valuation for an examination (for the exam cell). */
export async function valuationProgress(examinationId: string) {
  const groups = await db.answerScript.groupBy({ by: ["status"], where: { examinationId }, _count: { _all: true } });
  const absent = await db.answerScript.count({ where: { examinationId, absent: true } });
  return { byStatus: Object.fromEntries(groups.map((g) => [g.status, g._count._all])) as Record<string, number>, absent };
}
