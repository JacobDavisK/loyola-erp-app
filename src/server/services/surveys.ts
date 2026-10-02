import "server-only";
import { createHmac } from "node:crypto";
import { z } from "zod";
import type { Prisma, Survey, SurveyKind } from "@/generated/prisma/client";
import { summariseSurvey, validateAnswers, type SurveyQuestion } from "@/lib/domain/teaching";
import { type AuthContext, can, isSuperAdmin, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { sha256 } from "@/server/security/crypto";
import { audit } from "@/server/services/audit";
import { notify } from "@/server/services/notifications";

/**
 * Feedback surveys.
 *  - Course exit: one statement per course outcome ("I can …"), answered on a 1–5 scale by the class.
 *    Its means become the indirect part of outcome attainment (OBE).
 *  - Teacher feedback: a standard questionnaire per class. Teachers see results only when at least
 *    five students answered, so no answer can be traced to a student.
 *  - Student satisfaction (NAAC SSS), alumni and employer surveys; alumni and employer surveys run on a
 *    public link.
 * Anonymous surveys store only a keyed hash of the respondent (to stop duplicate answers), never who answered.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });
export const MIN_RESPONSES_FOR_TEACHERS = 5;

/** The public link token is derived from the survey id with the server secret, so it can be shown again later. */
export const publicToken = (surveyId: string) => createHmac("sha256", env.APP_SECRET).update(`survey-link:${surveyId}`).digest("base64url").slice(0, 24);
export const publicSurveyUrl = (surveyId: string) => `${env.APP_URL.replace(/\/$/, "")}/s/${publicToken(surveyId)}`;

const respondentHash = (surveyId: string, who: string) => createHmac("sha256", env.APP_SECRET).update(`survey:${surveyId}:${who}`).digest("hex");

export const TEACHER_FEEDBACK_QUESTIONS: SurveyQuestion[] = [
  { id: "prepared", type: "LIKERT", text: "The teacher came prepared for classes." },
  { id: "clarity", type: "LIKERT", text: "The teacher explained concepts clearly." },
  { id: "pace", type: "LIKERT", text: "The pace of teaching was right for me." },
  { id: "doubts", type: "LIKERT", text: "The teacher encouraged questions and cleared doubts." },
  { id: "assessment", type: "LIKERT", text: "Assessments were fair and returned with useful feedback." },
  { id: "punctual", type: "LIKERT", text: "Classes started and ended on time." },
  { id: "best", type: "TEXT", text: "What did you like most about this course?" },
  { id: "improve", type: "TEXT", text: "What should be improved?" },
];

export const SSS_QUESTIONS: SurveyQuestion[] = [
  { id: "syllabus", type: "LIKERT", text: "The syllabus was covered in the classes." },
  { id: "preparation", type: "LIKERT", text: "Teachers prepared well for the classes." },
  { id: "communication", type: "LIKERT", text: "Teachers communicated clearly." },
  { id: "approach", type: "LIKERT", text: "The teaching approach helped me learn." },
  { id: "evaluation", type: "LIKERT", text: "Internal evaluation was fair and transparent." },
  { id: "mentoring", type: "LIKERT", text: "My mentor helped me with academic and personal concerns." },
  { id: "ict", type: "LIKERT", text: "Teachers used ICT tools (the learning platform, videos, quizzes) effectively." },
  { id: "opportunities", type: "LIKERT", text: "The institution gives opportunities to learn and grow beyond the classroom." },
  { id: "suggestions", type: "TEXT", text: "Suggestions to improve the teaching–learning process." },
];

const questionSchema = z.object({ id: z.string().regex(/^[a-z0-9_]{1,30}$/), type: z.enum(["LIKERT", "CHOICE", "TEXT"]), text: z.string().trim().min(3).max(300), options: z.array(z.string().trim().min(1).max(100)).max(10).optional(), outcomeId: z.string().nullable().optional() });

// ───────────────────────── Who may run and see what ─────────────────────────

async function canManage(ctx: AuthContext, s: { offeringId: string | null; createdById: string }) {
  if (isSuperAdmin(ctx) || s.createdById === ctx.user.id) return true;
  if (!s.offeringId) return can(ctx, "survey.manage") && scopeOf(ctx, "survey.manage") === null;
  const o = await db.courseOffering.findUnique({ where: { id: s.offeringId }, select: { course: { select: { departmentId: true } }, instructors: { select: { userId: true } } } });
  return !!o && (can(ctx, "survey.manage", o.course.departmentId) || o.instructors.some((i) => i.userId === ctx.user.id));
}

async function canSeeResults(ctx: AuthContext, s: Survey, responses: number) {
  if (isSuperAdmin(ctx) || s.createdById === ctx.user.id && s.kind !== "TEACHER_FEEDBACK") return true;
  if (!s.offeringId) return can(ctx, "survey.results");
  const o = await db.courseOffering.findUnique({ where: { id: s.offeringId }, select: { course: { select: { departmentId: true } }, instructors: { select: { userId: true } } } });
  if (!o) return false;
  if (can(ctx, "survey.results", o.course.departmentId)) return true;
  // Teachers see their own class's results once enough students answered.
  return o.instructors.some((i) => i.userId === ctx.user.id) && (s.kind !== "TEACHER_FEEDBACK" || responses >= MIN_RESPONSES_FOR_TEACHERS);
}

// ───────────────────────── Creating surveys ─────────────────────────

const surveySchema = z.object({
  title: z.string().trim().min(3).max(200),
  kind: z.enum(["COURSE_EXIT", "TEACHER_FEEDBACK", "STUDENT_SATISFACTION", "ALUMNI", "EMPLOYER", "GENERAL"]),
  audience: z.enum(["CLASS", "STUDENTS", "STAFF", "PUBLIC_LINK"]),
  offeringId: z.string().nullable().optional(),
  anonymous: z.boolean().default(true),
  opensAt: z.coerce.date(),
  closesAt: z.coerce.date(),
  questions: z.array(questionSchema).min(1).max(40).optional(),
}).refine((v) => v.closesAt > v.opensAt, { path: ["closesAt"], message: "Must close after it opens" });

/** Default questions for a kind; course-exit questions come from the class's course outcomes. */
async function defaultQuestions(kind: SurveyKind, offeringId: string | null): Promise<SurveyQuestion[]> {
  if (kind === "TEACHER_FEEDBACK") return TEACHER_FEEDBACK_QUESTIONS;
  if (kind === "STUDENT_SATISFACTION") return SSS_QUESTIONS;
  if (kind === "COURSE_EXIT" && offeringId) {
    const o = await db.courseOffering.findUniqueOrThrow({ where: { id: offeringId }, select: { course: { select: { outcomes: { orderBy: { code: "asc" }, select: { id: true, code: true, description: true } } } } } });
    if (!o.course.outcomes.length) throw invalid("The course has no course outcomes to ask about.");
    return [...o.course.outcomes.map((c) => ({ id: c.code.toLowerCase(), type: "LIKERT" as const, text: `I am able to: ${c.description.replace(/\.$/, "")}.`, outcomeId: c.id })), { id: "comments", type: "TEXT" as const, text: "Anything else about this course?" }];
  }
  return [];
}

export async function createSurvey(ctx: AuthContext, raw: unknown) {
  const v = surveySchema.parse(raw);
  const offeringId = v.audience === "CLASS" ? v.offeringId ?? null : null;
  if (v.audience === "CLASS" && !offeringId) throw invalid("Choose the class.");
  if (["COURSE_EXIT", "TEACHER_FEEDBACK"].includes(v.kind) && !offeringId) throw invalid("Course-exit and teacher-feedback surveys are for one class.");
  if (offeringId ? !(await canManage(ctx, { offeringId, createdById: "" })) : !can(ctx, "survey.manage")) throw forbidden();
  const questions = v.questions?.length ? v.questions : await defaultQuestions(v.kind, offeringId);
  if (!questions.length) throw invalid("Add at least one question.");
  if (new Set(questions.map((q) => q.id)).size !== questions.length) throw invalid("Question ids must be unique.");
  if (offeringId && (await db.survey.findFirst({ where: { offeringId, kind: v.kind, status: { not: "CLOSED" } } }))) throw conflict("This class already has an open survey of this kind.");
  let s = await db.survey.create({
    data: { title: v.title, kind: v.kind, audience: v.audience, offeringId, anonymous: v.kind === "TEACHER_FEEDBACK" || v.kind === "STUDENT_SATISFACTION" ? true : v.anonymous, questions: questions as unknown as Prisma.InputJsonValue, opensAt: v.opensAt, closesAt: v.closesAt, createdById: ctx.user.id },
  });
  const token = v.audience === "PUBLIC_LINK" ? publicToken(s.id) : null;
  if (token) s = await db.survey.update({ where: { id: s.id }, data: { publicTokenHash: sha256(token) } });
  await audit({ ...actor(ctx), action: "survey.create", resourceType: "survey", resourceId: s.id, summary: `${v.kind}: ${v.title}` });
  return { survey: s, publicToken: token };
}

/** Course-exit and teacher-feedback surveys for every class of a term (department in scope). */
export async function createTermSurveys(ctx: AuthContext, raw: unknown) {
  const v = z.object({ termId: z.string(), opensAt: z.coerce.date(), closesAt: z.coerce.date() }).parse(raw);
  if (v.closesAt <= v.opensAt) throw invalid("The surveys must close after they open.");
  const scope = scopeOf(ctx, "survey.manage");
  if (scope !== null && !scope.length) throw forbidden();
  const offerings = await db.courseOffering.findMany({ where: { termId: v.termId, status: { not: "CANCELLED" }, ...(scope === null ? {} : { course: { departmentId: { in: scope } } }) }, include: { course: { select: { code: true, title: true, outcomes: { select: { id: true } } } }, surveys: { where: { status: { not: "CLOSED" } }, select: { kind: true } } } });
  let created = 0;
  for (const o of offerings) {
    const label = `${o.course.code}-${o.section}`;
    if (!o.surveys.some((s) => s.kind === "TEACHER_FEEDBACK")) {
      await createSurvey(ctx, { title: `Teacher feedback — ${label}`, kind: "TEACHER_FEEDBACK", audience: "CLASS", offeringId: o.id, opensAt: v.opensAt, closesAt: v.closesAt });
      created++;
    }
    if (o.course.outcomes.length && !o.surveys.some((s) => s.kind === "COURSE_EXIT")) {
      await createSurvey(ctx, { title: `Course exit survey — ${label}`, kind: "COURSE_EXIT", audience: "CLASS", offeringId: o.id, anonymous: true, opensAt: v.opensAt, closesAt: v.closesAt });
      created++;
    }
  }
  return created;
}

export async function setSurveyStatus(ctx: AuthContext, id: string, status: "OPEN" | "CLOSED") {
  const s = await db.survey.findUnique({ where: { id } });
  if (!s) throw notFound("Survey");
  if (!(await canManage(ctx, s))) throw forbidden();
  if (s.status === "CLOSED") throw workflowError("The survey is closed.");
  await db.survey.update({ where: { id }, data: { status } });
  if (status === "OPEN" && s.audience !== "PUBLIC_LINK") {
    const userIds = s.offeringId
      ? (await db.courseRegistration.findMany({ where: { offeringId: s.offeringId, status: "REGISTERED", student: { userId: { not: null } } }, select: { student: { select: { userId: true } } } })).map((r) => r.student.userId!)
      : s.audience === "STUDENTS" ? (await db.user.findMany({ where: { userType: "STUDENT", status: "ACTIVE" }, select: { id: true } })).map((u) => u.id)
      : (await db.user.findMany({ where: { userType: "STAFF", status: "ACTIVE" }, select: { id: true } })).map((u) => u.id);
    await notify({ userIds, type: "survey.open", title: `Your feedback, please: ${s.title}`, body: `Open until ${s.closesAt.toISOString().slice(0, 10)}${s.anonymous ? " · anonymous" : ""}`, link: `/surveys/${s.id}/respond`, email: false });
  }
  await audit({ ...actor(ctx), action: `survey.${status.toLowerCase()}`, resourceType: "survey", resourceId: id, summary: s.title });
}

// ───────────────────────── Responding ─────────────────────────

/** Surveys the signed-in person is asked to answer, with whether they already did. */
export async function mySurveys(ctx: AuthContext) {
  const now = new Date();
  const studentId = ctx.subject.studentId;
  const or: Prisma.SurveyWhereInput[] = [];
  if (studentId) {
    or.push({ audience: "CLASS", offering: { registrations: { some: { studentId, status: "REGISTERED" } } } });
    or.push({ audience: "STUDENTS" });
  }
  if (ctx.user.userType === "STAFF") or.push({ audience: "STAFF" });
  if (!or.length) return [];
  const list = await db.survey.findMany({ where: { status: "OPEN", opensAt: { lte: now }, closesAt: { gte: now }, OR: or }, orderBy: { closesAt: "asc" }, include: { offering: { select: { course: { select: { code: true } }, section: true } } } });
  const answered = new Set((await db.surveyResponse.findMany({ where: { surveyId: { in: list.map((s) => s.id) }, respondentHash: { in: list.map((s) => respondentHash(s.id, ctx.user.id)) } }, select: { surveyId: true } })).map((r) => r.surveyId));
  return list.map((s) => ({ ...s, answered: answered.has(s.id) }));
}

async function surveyForRespondent(ctx: AuthContext, id: string) {
  const s = await db.survey.findUnique({ where: { id } });
  if (!s || s.status !== "OPEN") throw notFound("Survey");
  const now = new Date();
  if (now < s.opensAt || now > s.closesAt) throw workflowError("This survey is not open.");
  const studentId = ctx.subject.studentId;
  const allowed =
    (s.audience === "CLASS" && !!studentId && !!(await db.courseRegistration.findFirst({ where: { offeringId: s.offeringId!, studentId, status: "REGISTERED" } }))) ||
    (s.audience === "STUDENTS" && !!studentId) ||
    (s.audience === "STAFF" && ctx.user.userType === "STAFF");
  if (!allowed) throw notFound("Survey");
  return s;
}

export async function loadSurveyForm(ctx: AuthContext, id: string) {
  const s = await surveyForRespondent(ctx, id);
  const done = await db.surveyResponse.findUnique({ where: { surveyId_respondentHash: { surveyId: id, respondentHash: respondentHash(id, ctx.user.id) } } });
  return { survey: s, questions: s.questions as unknown as SurveyQuestion[], answered: !!done };
}

const answersSchema = z.record(z.string(), z.union([z.number(), z.string().max(2000), z.null()]));

async function storeResponse(survey: Survey, who: string, userId: string | null, raw: unknown) {
  const answers = answersSchema.parse(raw);
  const err = validateAnswers(survey.questions as unknown as SurveyQuestion[], answers);
  if (err) throw invalid(err);
  if (!Object.values(answers).some((a) => a !== null && a !== "")) throw invalid("Answer at least one question.");
  try {
    await db.surveyResponse.create({ data: { surveyId: survey.id, respondentHash: respondentHash(survey.id, who), userId: survey.anonymous ? null : userId, answers } });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") throw conflict("You have already answered this survey. Thank you!");
    throw e;
  }
}

export async function respond(ctx: AuthContext, id: string, raw: unknown) {
  const s = await surveyForRespondent(ctx, id);
  await storeResponse(s, ctx.user.id, ctx.user.id, raw);
}

/** Public-link surveys (alumni, employers): one answer per browser, identified by a random id it keeps. */
export async function publicSurvey(token: string) {
  const s = await db.survey.findUnique({ where: { publicTokenHash: sha256(token) } });
  if (!s || s.status !== "OPEN" || s.audience !== "PUBLIC_LINK") throw notFound("Survey");
  const now = new Date();
  if (now < s.opensAt || now > s.closesAt) throw workflowError("This survey is not open.");
  return s;
}

export async function respondPublic(token: string, browserId: string, raw: unknown) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(browserId)) throw invalid("Invalid request.");
  const s = await publicSurvey(token);
  await storeResponse(s, `public:${browserId}`, null, raw);
}

// ───────────────────────── Results ─────────────────────────

export async function surveyResults(ctx: AuthContext, id: string) {
  const s = await db.survey.findUnique({ where: { id }, include: { offering: { select: { course: { select: { code: true, title: true } }, section: true } } } });
  if (!s) throw notFound("Survey");
  const responses = await db.surveyResponse.findMany({ where: { surveyId: id }, select: { answers: true, userId: true, submittedAt: true } });
  if (!(await canSeeResults(ctx, s, responses.length))) throw forbidden(s.kind === "TEACHER_FEEDBACK" ? `Results appear once at least ${MIN_RESPONSES_FOR_TEACHERS} students have answered.` : undefined);
  const questions = s.questions as unknown as SurveyQuestion[];
  const invited = s.offeringId ? await db.courseRegistration.count({ where: { offeringId: s.offeringId, status: { in: ["REGISTERED", "COMPLETED"] } } }) : null;
  return { survey: s, questions, responses: responses.length, invited, summary: summariseSurvey(questions, responses.map((r) => r.answers as Record<string, unknown>)), manage: await canManage(ctx, s) };
}


/** Mean of the latest student satisfaction survey (for NAAC). */
export async function satisfactionIndex(): Promise<{ mean: number | null; responses: number }> {
  const s = await db.survey.findFirst({ where: { kind: "STUDENT_SATISFACTION" }, orderBy: { createdAt: "desc" } });
  if (!s) return { mean: null, responses: 0 };
  const responses = await db.surveyResponse.findMany({ where: { surveyId: s.id }, select: { answers: true } });
  const sum = summariseSurvey(s.questions as unknown as SurveyQuestion[], responses.map((r) => r.answers as Record<string, unknown>)).filter((q) => q.mean !== null);
  return { mean: sum.length ? Math.round((sum.reduce((a, q) => a + q.mean!, 0) / sum.length) * 100) / 100 : null, responses: responses.length };
}
