import "server-only";
import { z } from "zod";
import { courseOutcomeAttainment, likertToLevel, programOutcomeAttainment, type MarkTable, type ObeComponent } from "@/lib/domain/compliance";
import { summariseSurvey, type SurveyQuestion } from "@/lib/domain/teaching";
import { type AuthContext, can, isSuperAdmin } from "@/server/auth/current";
import { db } from "@/server/db";
import { conflict, forbidden, invalid, notFound } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { getSetting } from "@/server/services/settings";

/**
 * Outcome-based education (NBA / NAAC criterion 2.6).
 *
 *  - Programme outcomes (POs, PSOs) per programme; course outcomes (COs) per course.
 *  - The CO–PO matrix (correlation 1–3) per course.
 *  - Each assessment component of a class is mapped to the COs it measures.
 *  - Attainment is computed from the marks already entered: no separate data entry. The indirect part
 *    comes from course-exit surveys when the class has one (see surveys).
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });

function assertObe(ctx: AuthContext, departmentId: string) {
  if (!can(ctx, "obe.manage", departmentId)) throw forbidden();
}

// ───────────────────────── Programme outcomes ─────────────────────────

const poSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^(PO|PSO)\d{1,2}$/, "Use PO1…PO12 or PSO1…"),
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().min(5).max(2000),
});

export async function saveProgramOutcome(ctx: AuthContext, programId: string, id: string | null, raw: unknown) {
  const p = await db.program.findUnique({ where: { id: programId } });
  if (!p) throw notFound("Programme");
  assertObe(ctx, p.departmentId);
  const v = poSchema.parse(raw);
  const kind = v.code.startsWith("PSO") ? "PSO" : "PO";
  const order = Number(v.code.replace(/\D/g, "")) + (kind === "PSO" ? 100 : 0);
  if (await db.programOutcome.findFirst({ where: { programId, code: v.code, ...(id ? { id: { not: id } } : {}) } })) throw conflict(`${v.code} already exists.`);
  const po = id ? await db.programOutcome.update({ where: { id }, data: { ...v, kind, order } }) : await db.programOutcome.create({ data: { ...v, kind, order, programId } });
  await audit({ ...actor(ctx), action: "obe.po.save", resourceType: "program", resourceId: programId, summary: `${p.code} ${v.code}: ${v.title}` });
  return po;
}

export async function deleteProgramOutcome(ctx: AuthContext, id: string) {
  const po = await db.programOutcome.findUnique({ where: { id }, include: { program: true } });
  if (!po) throw notFound("Outcome");
  assertObe(ctx, po.program.departmentId);
  await db.programOutcome.delete({ where: { id } });
  await audit({ ...actor(ctx), action: "obe.po.delete", resourceType: "program", resourceId: po.programId, summary: `${po.program.code} ${po.code}` });
}

// ───────────────────────── Course outcomes and the CO–PO matrix ─────────────────────────

const coSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^CO\d{1,2}$/, "Use CO1, CO2…"),
  description: z.string().trim().min(5).max(1000),
  bloom: z.enum(["REMEMBER", "UNDERSTAND", "APPLY", "ANALYZE", "EVALUATE", "CREATE"]).nullable().optional(),
});

export async function saveCourseOutcome(ctx: AuthContext, courseId: string, id: string | null, raw: unknown) {
  const c = await db.course.findUnique({ where: { id: courseId } });
  if (!c) throw notFound("Course");
  assertObe(ctx, c.departmentId);
  const v = coSchema.parse(raw);
  if (await db.learningOutcome.findFirst({ where: { courseId, code: v.code, ...(id ? { id: { not: id } } : {}) } })) throw conflict(`${v.code} already exists for ${c.code}.`);
  const data = { code: v.code, description: v.description, bloom: v.bloom ?? null };
  const co = id ? await db.learningOutcome.update({ where: { id }, data }) : await db.learningOutcome.create({ data: { ...data, courseId } });
  await audit({ ...actor(ctx), action: "obe.co.save", resourceType: "course", resourceId: courseId, summary: `${c.code} ${v.code}` });
  return co;
}

export async function deleteCourseOutcome(ctx: AuthContext, id: string) {
  const co = await db.learningOutcome.findUnique({ where: { id }, include: { course: true, _count: { select: { questions: true } } } });
  if (!co) throw notFound("Outcome");
  assertObe(ctx, co.course.departmentId);
  if (co._count.questions) throw conflict("Questions in the bank are tagged with this outcome; retag them first.");
  await db.learningOutcome.delete({ where: { id } });
  await audit({ ...actor(ctx), action: "obe.co.delete", resourceType: "course", resourceId: co.courseId, summary: `${co.course.code} ${co.code}` });
}

/** Replace a course's CO–PO matrix. `cells` maps "<coId>:<poId>" to strength 0 (none) … 3. */
export async function setCoPoMatrix(ctx: AuthContext, courseId: string, raw: unknown) {
  const c = await db.course.findUnique({ where: { id: courseId }, include: { outcomes: { select: { id: true } } } });
  if (!c) throw notFound("Course");
  assertObe(ctx, c.departmentId);
  const cells = z.record(z.string(), z.number().int().min(0).max(3)).parse(raw);
  const pos = new Set((await db.programOutcome.findMany({ where: { programId: c.programId }, select: { id: true } })).map((p) => p.id));
  const cos = new Set(c.outcomes.map((o) => o.id));
  const rows: { outcomeId: string; programOutcomeId: string; strength: number }[] = [];
  for (const [key, strength] of Object.entries(cells)) {
    const [co, po] = key.split(":");
    if (!cos.has(co) || !pos.has(po)) throw invalid("The matrix refers to an outcome of another course or programme.");
    if (strength > 0) rows.push({ outcomeId: co, programOutcomeId: po, strength });
  }
  await db.$transaction(async (tx) => {
    await tx.coPoMapping.deleteMany({ where: { outcomeId: { in: [...cos] } } });
    if (rows.length) await tx.coPoMapping.createMany({ data: rows });
    await audit({ ...actor(ctx), action: "obe.matrix", resourceType: "course", resourceId: courseId, summary: `${c.code}: ${rows.length} CO–PO correlation(s)` }, tx);
  });
}

// ───────────────────────── Component mapping ─────────────────────────

async function loadOffering(offeringId: string) {
  const o = await db.courseOffering.findUnique({ where: { id: offeringId }, include: { course: true, term: true, instructors: { select: { userId: true } } } });
  if (!o) throw notFound("Class");
  return o;
}

const isInstructor = (ctx: AuthContext, o: { instructors: { userId: string }[] }) => o.instructors.some((i) => i.userId === ctx.user.id);

/** The class's teachers (and OBE coordinators of the department) say which COs each component measures. */
export async function setComponentOutcomes(ctx: AuthContext, componentId: string, outcomeIds: string[]) {
  const comp = await db.assessmentComponent.findUnique({ where: { id: componentId }, include: { offering: { include: { course: true, instructors: { select: { userId: true } } } } } });
  if (!comp) throw notFound("Component");
  if (!isInstructor(ctx, comp.offering) && !can(ctx, "obe.manage", comp.offering.course.departmentId) && !isSuperAdmin(ctx)) throw forbidden();
  const valid = new Set((await db.learningOutcome.findMany({ where: { courseId: comp.offering.courseId }, select: { id: true } })).map((o) => o.id));
  const ids = [...new Set(outcomeIds)];
  if (ids.some((x) => !valid.has(x))) throw invalid("Choose outcomes of this course.");
  await db.$transaction(async (tx) => {
    await tx.componentOutcome.deleteMany({ where: { componentId } });
    if (ids.length) await tx.componentOutcome.createMany({ data: ids.map((outcomeId) => ({ componentId, outcomeId })) });
    await audit({ ...actor(ctx), action: "obe.component", resourceType: "offering", resourceId: comp.offeringId, summary: `${comp.offering.course.code} ${comp.name}: ${ids.length} outcome(s)` }, tx);
  });
}

// ───────────────────────── Attainment ─────────────────────────

export function canViewObe(ctx: AuthContext, departmentId: string, instructorIds: string[] = []) {
  return can(ctx, "obe.view", departmentId) || can(ctx, "obe.manage", departmentId) || instructorIds.includes(ctx.user.id);
}

/** Indirect levels per CO (0–3) from the class's course-exit survey. */
async function indirectSource(offeringId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  // The most recent course-exit survey of the class that at least three students answered.
  const surveys = await db.survey.findMany({ where: { offeringId, kind: "COURSE_EXIT" }, orderBy: { createdAt: "desc" }, include: { _count: { select: { responses: true } } } });
  const s = surveys.find((x) => x._count.responses >= 3);
  if (!s) return out;
  const questions = s.questions as unknown as SurveyQuestion[];
  const responses = await db.surveyResponse.findMany({ where: { surveyId: s.id }, select: { answers: true } });
  for (const q of summariseSurvey(questions, responses.map((r) => r.answers as Record<string, unknown>))) {
    const outcomeId = questions.find((x) => x.id === q.id)?.outcomeId;
    if (outcomeId && q.mean !== null) out.set(outcomeId, likertToLevel(q.mean));
  }
  return out;
}

export async function offeringAttainment(ctx: AuthContext | null, offeringId: string) {
  const o = await loadOffering(offeringId);
  if (ctx && !canViewObe(ctx, o.course.departmentId, o.instructors.map((i) => i.userId)) && !isSuperAdmin(ctx)) throw notFound("Class");
  const policy = await getSetting("obe");
  const [outcomes, components, regs] = await Promise.all([
    db.learningOutcome.findMany({ where: { courseId: o.courseId }, orderBy: { code: "asc" } }),
    db.assessmentComponent.findMany({ where: { offeringId }, include: { outcomes: { select: { outcomeId: true } }, marks: { select: { studentId: true, marks: true, status: true } } }, orderBy: { order: "asc" } }),
    db.courseRegistration.findMany({ where: { offeringId, status: { in: ["REGISTERED", "COMPLETED"] } }, select: { studentId: true } }),
  ]);
  const students = regs.map((r) => r.studentId);
  const marks: MarkTable = new Map();
  for (const c of components) for (const m of c.marks) {
    const row = marks.get(m.studentId) ?? marks.set(m.studentId, new Map()).get(m.studentId)!;
    row.set(c.id, m.status === "PRESENT" ? m.marks : 0);
  }
  const obeComponents: ObeComponent[] = components.map((c) => ({ id: c.id, maxMarks: c.maxMarks, external: c.kind === "EXTERNAL", outcomeIds: c.outcomes.map((x) => x.outcomeId) }));
  const indirect = await indirectSource(offeringId);
  const rows = courseOutcomeAttainment(outcomes.map((x) => x.id), obeComponents, marks, students, policy, indirect);
  return {
    offering: o,
    policy,
    outcomes,
    components: components.map((c) => ({ id: c.id, name: c.name, kind: c.kind, maxMarks: c.maxMarks, outcomeIds: c.outcomes.map((x) => x.outcomeId), entered: c.marks.length })),
    students: students.length,
    attainment: rows,
    unmappedOutcomes: outcomes.filter((x) => !obeComponents.some((c) => c.outcomeIds.includes(x.id))).map((x) => x.code),
  };
}

/** Programme-outcome attainment over the classes of the chosen terms (default: every term with marks). */
export async function programAttainment(ctx: AuthContext, programId: string, termIds?: string[]) {
  const p = await db.program.findUnique({ where: { id: programId } });
  if (!p) throw notFound("Programme");
  if (!can(ctx, "obe.view", p.departmentId) && !can(ctx, "obe.manage", p.departmentId)) throw forbidden();
  const policy = await getSetting("obe");
  const [pos, offerings] = await Promise.all([
    db.programOutcome.findMany({ where: { programId }, orderBy: { order: "asc" } }),
    db.courseOffering.findMany({ where: { course: { programId }, ...(termIds?.length ? { termId: { in: termIds } } : {}), components: { some: { outcomes: { some: {} } } } }, select: { id: true, courseId: true, course: { select: { code: true, title: true } }, term: { select: { name: true } } } }),
  ]);
  const mappings = await db.coPoMapping.findMany({ where: { programOutcome: { programId } } });
  const courseRows: { offeringId: string; course: string; title: string; term: string; po: { programOutcomeId: string; value: number | null }[]; co: { code: string; final: number | null }[] }[] = [];
  const coValues = new Map<string, number[]>();
  for (const off of offerings) {
    const a = await offeringAttainment(null, off.id);
    const values = new Map(a.attainment.map((r) => [r.outcomeId, r.final]));
    for (const [k, v] of values) if (v !== null) (coValues.get(k) ?? coValues.set(k, []).get(k)!).push(v);
    courseRows.push({
      offeringId: off.id, course: off.course.code, title: off.course.title, term: off.term.name,
      po: programOutcomeAttainment(pos.map((x) => x.id), mappings, values),
      co: a.attainment.map((r) => ({ code: a.outcomes.find((x) => x.id === r.outcomeId)?.code ?? "?", final: r.final })),
    });
  }
  // A CO taught in several classes contributes the mean of its attainments.
  const meanCo = new Map([...coValues].map(([k, v]) => [k, Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100]));
  const overall = programOutcomeAttainment(pos.map((x) => x.id), mappings, meanCo);
  return { program: p, policy, pos, courses: courseRows, overall };
}
