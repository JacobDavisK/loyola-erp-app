import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { answerKeySchemas, applyPenalty, attemptDeadline, checkWindow, gradeAttempt, optionSchema, scaleScore, seededShuffle, SUBMIT_GRACE_MS, type QuestionType } from "@/lib/domain/lms";
import { type AuthContext, can, isSuperAdmin } from "@/server/auth/current";
import { db } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { saveMarks } from "@/server/services/marks";
import { notify } from "@/server/services/notifications";
import { saveFile } from "@/server/storage";

/**
 * Learning management inside a class (CourseOffering): modules and learning items, announcements,
 * assignments with submissions and grading, auto-graded quizzes, and a gradebook that can feed internal marks.
 *
 * Access is relationship-based:
 *  - teacher: listed as an instructor of the class — edits everything in the course space;
 *  - manager: department staff with enrollment.manage / academic.manage — read-only oversight;
 *  - student: registered in the class — sees published content and their own work only.
 */

export type CourseRole = "teacher" | "manager" | "student";

export async function courseSpace(ctx: AuthContext, offeringId: string) {
  const o = await db.courseOffering.findUnique({
    where: { id: offeringId },
    include: { course: { select: { id: true, code: true, title: true, departmentId: true } }, term: { select: { name: true } }, instructors: { include: { user: { select: { id: true, name: true } } } } },
  });
  if (!o) throw notFound("Class");
  let role: CourseRole | null = null;
  let studentId: string | null = null;
  if (o.instructors.some((i) => i.userId === ctx.user.id) || isSuperAdmin(ctx)) role = "teacher";
  else if (can(ctx, "enrollment.manage", o.course.departmentId) || can(ctx, "academic.manage")) role = "manager";
  else if (ctx.subject.studentId) {
    const reg = await db.courseRegistration.findFirst({ where: { offeringId, studentId: ctx.subject.studentId, status: { in: ["REGISTERED", "COMPLETED"] } } });
    if (reg) { role = "student"; studentId = ctx.subject.studentId; }
  }
  if (!role) throw notFound("Class");
  return { offering: o, role, studentId };
}

export async function teacherOf(ctx: AuthContext, offeringId: string) {
  const s = await courseSpace(ctx, offeringId);
  if (s.role !== "teacher") throw forbidden("Only the class's instructors can change the course space.");
  return s;
}

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });

async function studentUserIds(offeringId: string, tx: Prisma.TransactionClient | typeof db = db) {
  const regs = await tx.courseRegistration.findMany({ where: { offeringId, status: "REGISTERED", student: { userId: { not: null } } }, select: { student: { select: { userId: true } } } });
  return regs.map((r) => r.student.userId!);
}

const optDate = z.union([z.coerce.date(), z.literal(""), z.null()]).optional().transform((v) => (v instanceof Date ? v : null));

// ───────────────────────── Modules & items ─────────────────────────

export const moduleSchema = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).nullable().optional(),
  order: z.number().int().min(0).max(500).default(0),
  isPublished: z.boolean().default(false),
});

export async function saveModule(ctx: AuthContext, offeringId: string, id: string | null, raw: unknown) {
  await teacherOf(ctx, offeringId);
  const v = moduleSchema.parse(raw);
  if (id && !(await db.courseModule.count({ where: { id, offeringId } }))) throw notFound("Module");
  const data = { ...v, description: v.description || null };
  const m = id ? await db.courseModule.update({ where: { id }, data }) : await db.courseModule.create({ data: { ...data, offeringId } });
  await audit({ ...actor(ctx), action: id ? "lms.module.update" : "lms.module.create", resourceType: "courseModule", resourceId: m.id, summary: m.title });
  return m;
}

export async function deleteModule(ctx: AuthContext, id: string) {
  const m = await db.courseModule.findUnique({ where: { id }, include: { _count: { select: { items: true } } } });
  if (!m) throw notFound("Module");
  await teacherOf(ctx, m.offeringId);
  if (m._count.items) throw conflict("Move or delete the module's items first.");
  await db.courseModule.delete({ where: { id } });
  await audit({ ...actor(ctx), action: "lms.module.delete", resourceType: "courseModule", resourceId: id, summary: m.title });
}

const httpUrl = z.string().trim().url().max(1000).refine((u) => /^https?:\/\//i.test(u), "Only http(s) links");

export const itemSchema = z.object({
  kind: z.enum(["PAGE", "LINK", "VIDEO"]),
  title: z.string().trim().min(2).max(200),
  body: z.string().trim().max(50_000).nullable().optional(),
  url: httpUrl.nullable().optional().or(z.literal("")),
  order: z.number().int().min(0).max(500).default(0),
  isPublished: z.boolean().default(false),
  availableFrom: optDate,
}).superRefine((v, c) => {
  if (v.kind === "PAGE" && !v.body) c.addIssue({ code: "custom", path: ["body"], message: "Write the page content" });
  if (v.kind !== "PAGE" && !v.url) c.addIssue({ code: "custom", path: ["url"], message: "Enter the link" });
});

async function moduleForTeacher(ctx: AuthContext, moduleId: string) {
  const m = await db.courseModule.findUnique({ where: { id: moduleId } });
  if (!m) throw notFound("Module");
  await teacherOf(ctx, m.offeringId);
  return m;
}

export async function saveItem(ctx: AuthContext, moduleId: string, id: string | null, raw: unknown) {
  await moduleForTeacher(ctx, moduleId);
  const v = itemSchema.parse(raw);
  if (id) {
    const cur = await db.learningItem.findFirst({ where: { id, moduleId } });
    if (!cur) throw notFound("Item");
    if (cur.kind === "FILE") throw invalid("Edit file items with the file form.");
  }
  const data = { kind: v.kind, title: v.title, body: v.body || null, url: v.kind === "PAGE" ? null : v.url || null, order: v.order, isPublished: v.isPublished, availableFrom: v.availableFrom };
  const it = id ? await db.learningItem.update({ where: { id }, data }) : await db.learningItem.create({ data: { ...data, moduleId, createdById: ctx.user.id } });
  await audit({ ...actor(ctx), action: id ? "lms.item.update" : "lms.item.create", resourceType: "learningItem", resourceId: it.id, summary: `${it.kind} ${it.title}` });
  return it;
}

/** Upload a file as a learning item (or replace the file of an existing file item). */
export async function uploadMaterial(ctx: AuthContext, moduleId: string, form: FormData) {
  await moduleForTeacher(ctx, moduleId);
  const file = form.get("file");
  const title = String(form.get("title") ?? "").trim();
  const itemId = String(form.get("itemId") ?? "") || null;
  if (!(file instanceof File) || file.size === 0) throw invalid("Choose a file to upload.");
  const asset = await saveFile({ data: Buffer.from(await file.arrayBuffer()), name: file.name, kind: "COURSE_MATERIAL", ownerId: ctx.user.id });
  const isPublished = form.get("isPublished") === "true";
  const data = { title: title.slice(0, 200) || asset.originalName, body: String(form.get("body") ?? "").trim().slice(0, 5000) || null, fileId: asset.id, isPublished };
  const it = itemId
    ? await db.learningItem.update({ where: { id: (await db.learningItem.findFirstOrThrow({ where: { id: itemId, moduleId, kind: "FILE" } })).id }, data })
    : await db.learningItem.create({ data: { ...data, kind: "FILE", moduleId, order: Number(form.get("order")) || 0, createdById: ctx.user.id } });
  await audit({ ...actor(ctx), action: "lms.item.upload", resourceType: "learningItem", resourceId: it.id, summary: `${asset.originalName} (${Math.round(asset.size / 1024)} KB)` });
  return it;
}

export async function deleteItem(ctx: AuthContext, id: string) {
  const it = await db.learningItem.findUnique({ where: { id }, include: { module: true } });
  if (!it) throw notFound("Item");
  await teacherOf(ctx, it.module.offeringId);
  await db.learningItem.delete({ where: { id } });
  await audit({ ...actor(ctx), action: "lms.item.delete", resourceType: "learningItem", resourceId: id, summary: it.title });
}

/** A student opens an item: returns it if visible and records the view (completion tracking). */
export async function openItem(ctx: AuthContext, id: string) {
  const it = await db.learningItem.findUnique({ where: { id }, include: { module: true, file: true } });
  if (!it) throw notFound("Item");
  const s = await courseSpace(ctx, it.module.offeringId);
  if (s.role === "student") {
    const now = new Date();
    if (!it.isPublished || !it.module.isPublished || (it.availableFrom && it.availableFrom > now)) throw notFound("Item");
    await db.learningItemView.upsert({
      where: { itemId_studentId: { itemId: id, studentId: s.studentId! } },
      create: { itemId: id, studentId: s.studentId! },
      update: { lastViewedAt: now, views: { increment: 1 } },
    });
  }
  return { item: it, role: s.role };
}

// ───────────────────────── Announcements ─────────────────────────

export async function postAnnouncement(ctx: AuthContext, offeringId: string, raw: unknown) {
  const s = await teacherOf(ctx, offeringId);
  const v = z.object({ title: z.string().trim().min(3).max(160), body: z.string().trim().min(3).max(10_000) }).parse(raw);
  return db.$transaction(async (tx) => {
    const a = await tx.courseAnnouncement.create({ data: { offeringId, title: v.title, body: v.body, authorId: ctx.user.id } });
    await notify({ userIds: await studentUserIds(offeringId, tx), type: "lms.announcement", title: `${s.offering.course.code}: ${v.title}`, body: v.body.slice(0, 200), link: `/portal/courses/${offeringId}?tab=announcements` }, tx);
    await audit({ ...actor(ctx), action: "lms.announcement", resourceType: "courseAnnouncement", resourceId: a.id, summary: v.title }, tx);
    return a;
  });
}

export async function deleteAnnouncement(ctx: AuthContext, id: string) {
  const a = await db.courseAnnouncement.findUnique({ where: { id } });
  if (!a) throw notFound("Announcement");
  await teacherOf(ctx, a.offeringId);
  await db.courseAnnouncement.delete({ where: { id } });
  await audit({ ...actor(ctx), action: "lms.announcement.delete", resourceType: "courseAnnouncement", resourceId: id, summary: a.title });
}

// ───────────────────────── Assignments ─────────────────────────

export const assignmentSchema = z.object({
  title: z.string().trim().min(3).max(200),
  instructions: z.string().trim().min(5).max(20_000),
  moduleId: z.string().nullable().optional().or(z.literal("")),
  maxMarks: z.number().positive().max(1000),
  dueAt: z.coerce.date(),
  closesAt: optDate,
  latePenaltyPercent: z.number().min(0).max(100).default(0),
  maxAttempts: z.number().int().min(1).max(20).default(1),
  allowText: z.boolean().default(true),
  allowFiles: z.boolean().default(true),
  maxFiles: z.number().int().min(0).max(10).default(3),
  isPublished: z.boolean().default(false),
}).superRefine((v, c) => {
  if (v.closesAt && v.closesAt < v.dueAt) c.addIssue({ code: "custom", path: ["closesAt"], message: "The late window must end after the due time" });
  if (!v.allowText && !v.allowFiles) c.addIssue({ code: "custom", path: ["allowText"], message: "Allow text, files or both" });
  if (v.allowFiles && v.maxFiles < 1) c.addIssue({ code: "custom", path: ["maxFiles"], message: "Allow at least one file" });
});

export async function saveAssignment(ctx: AuthContext, offeringId: string, id: string | null, raw: unknown) {
  const s = await teacherOf(ctx, offeringId);
  const v = assignmentSchema.parse(raw);
  if (v.moduleId && !(await db.courseModule.count({ where: { id: v.moduleId, offeringId } }))) throw invalid("Choose a module of this class.");
  const cur = id ? await db.assignment.findFirst({ where: { id, offeringId }, include: { _count: { select: { submissions: true } } } }) : null;
  if (id && !cur) throw notFound("Assignment");
  if (cur && cur._count.submissions && v.maxMarks !== cur.maxMarks && (await db.submission.count({ where: { assignmentId: id!, marks: { not: null } } }))) {
    throw conflict("Some submissions are already graded; the maximum marks cannot change.");
  }
  const firstPublish = v.isPublished && !cur?.publishedAt;
  const data = { ...v, moduleId: v.moduleId || null, closesAt: v.closesAt, publishedAt: firstPublish ? new Date() : cur?.publishedAt ?? null };
  return db.$transaction(async (tx) => {
    const a = cur ? await tx.assignment.update({ where: { id: cur.id }, data }) : await tx.assignment.create({ data: { ...data, offeringId, createdById: ctx.user.id } });
    if (firstPublish) await notify({ userIds: await studentUserIds(offeringId, tx), type: "lms.assignment", title: `New assignment in ${s.offering.course.code}: ${a.title}`, body: `Due ${a.dueAt.toISOString().slice(0, 16).replace("T", " ")} UTC`, link: `/portal/courses/${offeringId}/assignments/${a.id}` }, tx);
    await audit({ ...actor(ctx), action: cur ? "lms.assignment.update" : "lms.assignment.create", resourceType: "assignment", resourceId: a.id, summary: `${a.title}${firstPublish ? " (published)" : ""}` }, tx);
    return a;
  });
}

export async function deleteAssignment(ctx: AuthContext, id: string) {
  const a = await db.assignment.findUnique({ where: { id }, include: { _count: { select: { submissions: true } } } });
  if (!a) throw notFound("Assignment");
  await teacherOf(ctx, a.offeringId);
  if (a._count.submissions) throw conflict("Students have submitted work; the assignment cannot be deleted. Unpublish it instead.");
  await db.assignment.delete({ where: { id } });
  await audit({ ...actor(ctx), action: "lms.assignment.delete", resourceType: "assignment", resourceId: id, summary: a.title });
}

/** Attempts allowed so far: the configured maximum plus one for every submission returned for rework. */
export function attemptsAllowed(maxAttempts: number, submissions: { status: string }[]) {
  return maxAttempts + submissions.filter((x) => x.status === "RETURNED").length;
}

export async function submitAssignment(ctx: AuthContext, assignmentId: string, form: FormData) {
  const a = await db.assignment.findUnique({ where: { id: assignmentId } });
  if (!a) throw notFound("Assignment");
  const s = await courseSpace(ctx, a.offeringId);
  if (s.role !== "student" || !a.isPublished) throw notFound("Assignment");
  const reg = await db.courseRegistration.count({ where: { offeringId: a.offeringId, studentId: s.studentId!, status: "REGISTERED" } });
  if (!reg) throw forbidden("Only students currently registered in the class can submit.");
  const now = new Date();
  const w = checkWindow(a, now);
  if (!w.open) throw workflowError(w.reason);
  const previous = await db.submission.findMany({ where: { assignmentId, studentId: s.studentId! }, orderBy: { attempt: "desc" } });
  if (previous.length >= attemptsAllowed(a.maxAttempts, previous)) throw workflowError(`You have used all ${a.maxAttempts} attempt(s).`);
  const text = a.allowText ? String(form.get("text") ?? "").trim().slice(0, 50_000) || null : null;
  const files = a.allowFiles ? form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0) : [];
  if (files.length > a.maxFiles) throw invalid(`Attach at most ${a.maxFiles} file(s).`);
  if (!text && !files.length) throw invalid("Write an answer or attach a file.");
  const assets: { id: string }[] = [];
  try {
    for (const f of files) assets.push(await saveFile({ data: Buffer.from(await f.arrayBuffer()), name: f.name, kind: "SUBMISSION", ownerId: ctx.user.id }));
    return await db.$transaction(async (tx) => {
      const sub = await tx.submission.create({
        data: { assignmentId, studentId: s.studentId!, attempt: (previous[0]?.attempt ?? 0) + 1, text, isLate: w.late, penalty: w.penalty, files: { create: assets.map((x) => ({ fileId: x.id })) } },
      });
      await audit({ ...actor(ctx), action: "lms.submission", resourceType: "submission", resourceId: sub.id, summary: `${a.title}: attempt ${sub.attempt}${w.late ? " (late)" : ""}, ${assets.length} file(s)` }, tx);
      return sub;
    });
  } catch (e) {
    // Uploaded files of a failed submission are withdrawn (never linked, so never served).
    if (assets.length) await db.fileAsset.updateMany({ where: { id: { in: assets.map((x) => x.id) } }, data: { deletedAt: new Date() } });
    throw e;
  }
}

export async function gradeSubmission(ctx: AuthContext, submissionId: string, raw: unknown) {
  const sub = await db.submission.findUnique({ where: { id: submissionId }, include: { assignment: true } });
  if (!sub) throw notFound("Submission");
  await teacherOf(ctx, sub.assignment.offeringId);
  const v = z.object({ marks: z.number().min(0).nullable().optional(), feedback: z.string().trim().max(10_000).nullable().optional(), status: z.enum(["GRADED", "RETURNED"]) }).parse(raw);
  if (v.status === "GRADED" && (v.marks === null || v.marks === undefined)) throw invalid("Enter the marks.");
  if (v.marks != null && v.marks > sub.assignment.maxMarks) throw invalid(`Marks cannot exceed ${sub.assignment.maxMarks}.`);
  const marks = v.status === "GRADED" ? v.marks! : v.marks ?? null;
  const updated = await db.submission.update({
    where: { id: submissionId },
    data: { marks, finalMarks: marks === null ? null : applyPenalty(marks, sub.penalty), feedback: v.feedback || null, status: v.status, gradedById: ctx.user.id, gradedAt: new Date() },
  });
  await audit({ ...actor(ctx), action: "lms.submission.grade", resourceType: "submission", resourceId: submissionId, summary: `${sub.assignment.title}: ${v.status === "RETURNED" ? "returned for rework" : `${marks}/${sub.assignment.maxMarks}${sub.penalty ? ` − ${sub.penalty * 100}% late = ${updated.finalMarks}` : ""}`}` });
  if (v.status === "RETURNED") {
    const st = await db.student.findUnique({ where: { id: sub.studentId }, select: { userId: true } });
    if (st?.userId) await notify({ userIds: [st.userId], type: "lms.returned", title: `${sub.assignment.title} was returned for rework`, body: v.feedback?.slice(0, 200), link: `/portal/courses/${sub.assignment.offeringId}/assignments/${sub.assignmentId}` });
  }
  return updated;
}

export async function releaseGrades(ctx: AuthContext, assignmentId: string) {
  const a = await db.assignment.findUnique({ where: { id: assignmentId } });
  if (!a) throw notFound("Assignment");
  const s = await teacherOf(ctx, a.offeringId);
  if (a.gradesReleasedAt) return a;
  return db.$transaction(async (tx) => {
    const r = await tx.assignment.update({ where: { id: assignmentId }, data: { gradesReleasedAt: new Date() } });
    const graded = await tx.submission.findMany({ where: { assignmentId, status: "GRADED", student: { userId: { not: null } } }, distinct: ["studentId"], select: { student: { select: { userId: true } } } });
    await notify({ userIds: graded.map((g) => g.student.userId!), type: "lms.grades", title: `Marks released: ${s.offering.course.code} ${a.title}`, link: `/portal/courses/${a.offeringId}/assignments/${a.id}` }, tx);
    await audit({ ...actor(ctx), action: "lms.assignment.release", resourceType: "assignment", resourceId: assignmentId, summary: a.title }, tx);
    return r;
  });
}

// ───────────────────────── Quizzes ─────────────────────────

export const quizSchema = z.object({
  title: z.string().trim().min(3).max(200),
  instructions: z.string().trim().max(5000).nullable().optional(),
  moduleId: z.string().nullable().optional().or(z.literal("")),
  opensAt: z.coerce.date(),
  closesAt: z.coerce.date(),
  timeLimitMinutes: z.number().int().min(1).max(1440).nullable().optional(),
  maxAttempts: z.number().int().min(1).max(20).default(1),
  shuffleQuestions: z.boolean().default(false),
  reviewPolicy: z.enum(["AFTER_SUBMIT", "AFTER_CLOSE", "SCORE_ONLY", "NEVER"]).default("AFTER_CLOSE"),
  proctoring: z.enum(["NONE", "BASIC", "WEBCAM"]).default("NONE"),
  isPublished: z.boolean().default(false),
}).refine((v) => v.closesAt > v.opensAt, { path: ["closesAt"], message: "Closing time must be after opening" });

export async function saveQuiz(ctx: AuthContext, offeringId: string, id: string | null, raw: unknown) {
  const s = await teacherOf(ctx, offeringId);
  const v = quizSchema.parse(raw);
  if (v.moduleId && !(await db.courseModule.count({ where: { id: v.moduleId, offeringId } }))) throw invalid("Choose a module of this class.");
  const cur = id ? await db.quiz.findFirst({ where: { id, offeringId }, include: { _count: { select: { questions: true } } } }) : null;
  if (id && !cur) throw notFound("Quiz");
  if (v.isPublished && !(cur?._count.questions)) throw invalid("Add questions before publishing the quiz.");
  const data = { ...v, instructions: v.instructions || null, moduleId: v.moduleId || null, timeLimitMinutes: v.timeLimitMinutes ?? null };
  return db.$transaction(async (tx) => {
    const q = cur ? await tx.quiz.update({ where: { id: cur.id }, data }) : await tx.quiz.create({ data: { ...data, offeringId, createdById: ctx.user.id } });
    if (v.isPublished && !cur?.isPublished) await notify({ userIds: await studentUserIds(offeringId, tx), type: "lms.quiz", title: `Quiz in ${s.offering.course.code}: ${q.title}`, body: `Opens ${q.opensAt.toISOString().slice(0, 16).replace("T", " ")} UTC`, link: `/portal/courses/${offeringId}/quizzes/${q.id}` }, tx);
    await audit({ ...actor(ctx), action: cur ? "lms.quiz.update" : "lms.quiz.create", resourceType: "quiz", resourceId: q.id, summary: q.title }, tx);
    return q;
  });
}

export const questionSchema = z.object({
  type: z.enum(["SINGLE", "MULTIPLE", "TRUE_FALSE", "SHORT", "NUMERIC"]),
  prompt: z.string().trim().min(3).max(5000),
  options: z.array(optionSchema).max(10).nullable().optional(),
  answer: z.unknown(),
  marks: z.number().positive().max(100),
  explanation: z.string().trim().max(2000).nullable().optional(),
  order: z.number().int().min(0).max(500).default(0),
  /** Course outcome the question assesses */
  outcomeId: z.string().nullable().optional(),
});

/** Validate a question's options and answer key together. */
export function parseQuestion(raw: unknown) {
  const v = questionSchema.parse(raw);
  const type = v.type as QuestionType;
  const answer = answerKeySchemas[type].parse(v.answer);
  if (type === "SINGLE" || type === "MULTIPLE") {
    const opts = v.options ?? [];
    if (opts.length < 2) throw invalid("Give at least two options.");
    const ids = new Set(opts.map((o) => o.id));
    if (ids.size !== opts.length) throw invalid("Option ids must be unique.");
    const correct = (answer as { correct: string[] }).correct;
    if (!correct.every((c) => ids.has(c))) throw invalid("Mark the correct option(s).");
  }
  return { ...v, options: type === "SINGLE" || type === "MULTIPLE" ? v.options! : null, answer };
}

async function quizForTeacher(ctx: AuthContext, quizId: string) {
  const q = await db.quiz.findUnique({ where: { id: quizId }, include: { _count: { select: { attempts: true } } } });
  if (!q) throw notFound("Quiz");
  await teacherOf(ctx, q.offeringId);
  return q;
}

export async function saveQuestion(ctx: AuthContext, quizId: string, id: string | null, raw: unknown) {
  const quiz = await quizForTeacher(ctx, quizId);
  if (quiz._count.attempts) throw conflict("Students have attempted this quiz; its questions are locked. Create a new quiz instead.");
  const v = parseQuestion(raw);
  if (v.outcomeId) {
    const o = await db.courseOffering.findUniqueOrThrow({ where: { id: quiz.offeringId }, select: { courseId: true } });
    if (!(await db.learningOutcome.findFirst({ where: { id: v.outcomeId, courseId: o.courseId } }))) throw invalid("Choose an outcome of this course.");
  }
  const data = { type: v.type, prompt: v.prompt, options: (v.options ?? undefined) as Prisma.InputJsonValue | undefined, answer: v.answer as Prisma.InputJsonValue, marks: v.marks, explanation: v.explanation || null, order: v.order, outcomeId: v.outcomeId || null };
  const q = id ? await db.quizQuestion.update({ where: { id: (await db.quizQuestion.findFirstOrThrow({ where: { id, quizId } })).id }, data }) : await db.quizQuestion.create({ data: { ...data, quizId } });
  await audit({ ...actor(ctx), action: id ? "lms.question.update" : "lms.question.create", resourceType: "quiz", resourceId: quizId, summary: `${v.type}: ${v.prompt.slice(0, 80)}` });
  return q;
}

export async function deleteQuestion(ctx: AuthContext, id: string) {
  const q = await db.quizQuestion.findUnique({ where: { id } });
  if (!q) throw notFound("Question");
  const quiz = await quizForTeacher(ctx, q.quizId);
  if (quiz._count.attempts) throw conflict("Students have attempted this quiz; its questions are locked.");
  await db.quizQuestion.delete({ where: { id } });
}

/** Submit any in-progress attempts whose deadline (plus grace) has passed, grading the saved answers. */
export async function finalizeExpiredAttempts(where: Prisma.QuizAttemptWhereInput = {}) {
  const expired = await db.quizAttempt.findMany({ where: { AND: [where, { status: "IN_PROGRESS", deadlineAt: { lt: new Date(Date.now() - SUBMIT_GRACE_MS) } }] }, select: { id: true } });
  for (const a of expired) await finalizeAttempt(a.id, null);
  return expired.length;
}

async function finalizeAttempt(attemptId: string, answers: Record<string, unknown> | null) {
  return db.$transaction(async (tx) => {
    const a = await tx.quizAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { quiz: { include: { questions: true } } } });
    if (a.status === "SUBMITTED") return a;
    const final = answers ?? (a.answers as Record<string, unknown>);
    const g = gradeAttempt(a.quiz.questions.map((q) => ({ id: q.id, type: q.type, marks: q.marks, answer: q.answer })), final);
    return tx.quizAttempt.update({ where: { id: attemptId }, data: { answers: final as Prisma.InputJsonValue, status: "SUBMITTED", submittedAt: new Date(), marksAwarded: g.awarded, score: g.score, maxScore: g.maxScore } });
  });
}

/** Start a new attempt, or resume the one in progress. */
export async function startAttempt(ctx: AuthContext, quizId: string, opts: { proctorConsent?: boolean } = {}) {
  const quiz = await db.quiz.findUnique({ where: { id: quizId }, include: { questions: { select: { id: true, marks: true, order: true }, orderBy: { order: "asc" } } } });
  if (!quiz) throw notFound("Quiz");
  const s = await courseSpace(ctx, quiz.offeringId);
  if (s.role !== "student" || !quiz.isPublished) throw notFound("Quiz");
  await finalizeExpiredAttempts({ quizId, studentId: s.studentId! });
  const open = await db.quizAttempt.findFirst({ where: { quizId, studentId: s.studentId!, status: "IN_PROGRESS" } });
  if (open) return open;
  const now = new Date();
  if (now < quiz.opensAt) throw workflowError("The quiz has not opened yet.");
  if (now >= quiz.closesAt) throw workflowError("The quiz has closed.");
  const count = await db.quizAttempt.count({ where: { quizId, studentId: s.studentId! } });
  if (count >= quiz.maxAttempts) throw workflowError(`You have used all ${quiz.maxAttempts} attempt(s).`);
  if (quiz.proctoring !== "NONE" && !opts.proctorConsent) throw workflowError(quiz.proctoring === "WEBCAM" ? "This quiz is proctored with your webcam. Accept the proctoring notice to start." : "This quiz is proctored. Accept the proctoring notice to start.");
  const ids = quiz.questions.map((q) => q.id);
  const attemptNo = count + 1;
  const a = await db.quizAttempt.create({
    data: {
      quizId, studentId: s.studentId!, attemptNo, startedAt: now, deadlineAt: attemptDeadline(now, quiz.closesAt, quiz.timeLimitMinutes),
      questionOrder: quiz.shuffleQuestions ? seededShuffle(ids, `${quizId}:${s.studentId}:${attemptNo}`) : ids, maxScore: quiz.questions.reduce((x, q) => x + q.marks, 0),
      proctorConsentAt: quiz.proctoring !== "NONE" ? now : null,
    },
  });
  await audit({ ...actor(ctx), action: "lms.quiz.start", resourceType: "quizAttempt", resourceId: a.id, summary: `${quiz.title}: attempt ${attemptNo}` });
  return a;
}

const answersSchema = z.record(z.string().max(40), z.union([z.string().max(2000), z.number(), z.boolean(), z.array(z.string().max(20)).max(10), z.null()]));

async function ownAttempt(ctx: AuthContext, attemptId: string) {
  const a = await db.quizAttempt.findUnique({ where: { id: attemptId } });
  if (!a || !ctx.subject.studentId || a.studentId !== ctx.subject.studentId) throw notFound("Attempt");
  return a;
}

/** Save answers during an attempt. Answers arriving after the deadline (plus grace) are refused. */
export async function saveAnswers(ctx: AuthContext, attemptId: string, raw: unknown) {
  const a = await ownAttempt(ctx, attemptId);
  if (a.status !== "IN_PROGRESS") throw workflowError("This attempt has been submitted.");
  if (Date.now() > a.deadlineAt.getTime() + SUBMIT_GRACE_MS) {
    await finalizeAttempt(a.id, null);
    throw workflowError("Time is up. Your saved answers were submitted.");
  }
  const answers = answersSchema.parse(raw);
  const allowed = new Set(a.questionOrder as string[]);
  const clean = Object.fromEntries(Object.entries(answers).filter(([k]) => allowed.has(k)));
  await db.quizAttempt.update({ where: { id: a.id }, data: { answers: { ...(a.answers as object), ...clean } } });
}

export async function submitAttempt(ctx: AuthContext, attemptId: string, raw: unknown) {
  const a = await ownAttempt(ctx, attemptId);
  if (a.status === "SUBMITTED") return a;
  const late = Date.now() > a.deadlineAt.getTime() + SUBMIT_GRACE_MS;
  let answers: Record<string, unknown> | null = null;
  if (!late && raw) {
    const allowed = new Set(a.questionOrder as string[]);
    answers = { ...(a.answers as object), ...Object.fromEntries(Object.entries(answersSchema.parse(raw)).filter(([k]) => allowed.has(k))) };
  }
  const r = await finalizeAttempt(a.id, answers);
  await audit({ ...actor(ctx), action: "lms.quiz.submit", resourceType: "quizAttempt", resourceId: a.id, summary: `score ${r.score}/${r.maxScore}${late ? " (auto-submitted at the deadline)" : ""}` });
  return r;
}

// ───────────────────────── Gradebook ─────────────────────────

export interface GradebookColumn { key: string; kind: "assignment" | "quiz" | "tool"; id: string; title: string; max: number }

/** Scores per student: an assignment's latest graded submission (after penalty), a quiz's best attempt. */
export async function gradebook(ctx: AuthContext, offeringId: string) {
  const s = await courseSpace(ctx, offeringId);
  if (s.role === "student") throw forbidden();
  await finalizeExpiredAttempts({ quiz: { offeringId } });
  const [regs, assignments, quizzes, tools] = await Promise.all([
    db.courseRegistration.findMany({ where: { offeringId, status: { in: ["REGISTERED", "COMPLETED"] } }, include: { student: { select: { id: true, studentNo: true, firstName: true, lastName: true } } }, orderBy: { student: { studentNo: "asc" } } }),
    db.assignment.findMany({ where: { offeringId, isPublished: true }, orderBy: { dueAt: "asc" }, include: { submissions: { where: { status: "GRADED" }, orderBy: { attempt: "desc" }, select: { studentId: true, finalMarks: true } } } }),
    db.quiz.findMany({ where: { offeringId, isPublished: true }, orderBy: { opensAt: "asc" }, include: { attempts: { where: { status: "SUBMITTED" }, select: { studentId: true, score: true, maxScore: true } } } }),
    db.ltiLink.findMany({ where: { offeringId, maxScore: { not: null } }, orderBy: { createdAt: "asc" }, include: { scores: { where: { gradingProgress: "FullyGraded", scoreGiven: { not: null } }, orderBy: { timestamp: "desc" } } } }),
  ]);
  const columns: GradebookColumn[] = [
    ...assignments.map((a) => ({ key: `a:${a.id}`, kind: "assignment" as const, id: a.id, title: a.title, max: a.maxMarks })),
    ...quizzes.map((q) => ({ key: `q:${q.id}`, kind: "quiz" as const, id: q.id, title: q.title, max: q.attempts[0]?.maxScore ?? 0 })),
    ...tools.map((t) => ({ key: `l:${t.id}`, kind: "tool" as const, id: t.id, title: t.title, max: t.maxScore! })),
  ];
  const score = new Map<string, number>();
  for (const a of assignments) for (const sub of a.submissions) if (!score.has(`a:${a.id}:${sub.studentId}`) && sub.finalMarks !== null) score.set(`a:${a.id}:${sub.studentId}`, sub.finalMarks);
  for (const q of quizzes) for (const at of q.attempts) {
    const k = `q:${q.id}:${at.studentId}`;
    if (at.score !== null && (score.get(k) ?? -1) < at.score) score.set(k, at.score);
  }
  // External tools: the latest fully graded score, scaled to the placement's maximum.
  for (const t of tools) for (const sc of t.scores) {
    const k = `l:${t.id}:${sc.studentId}`;
    if (!score.has(k)) score.set(k, Math.round((sc.scoreGiven! / sc.scoreMaximum) * t.maxScore! * 100) / 100);
  }
  for (const c of columns) if (c.kind === "quiz" && c.max === 0) c.max = (await db.quizQuestion.aggregate({ where: { quizId: c.id }, _sum: { marks: true } }))._sum.marks ?? 0;
  const rows = regs.map((r) => ({ student: r.student, cells: Object.fromEntries(columns.map((c) => [c.key, score.get(`${c.key}:${r.student.id}`) ?? null])) as Record<string, number | null> }));
  return { space: s, columns, rows };
}

/**
 * Copy one gradebook column into an internal-assessment component of the same class, scaled to the
 * component's maximum. It goes through the normal marks rules (draft sheets only, audited); students
 * without a score are left blank for the instructor to decide.
 */
export async function transferToComponent(ctx: AuthContext, offeringId: string, raw: unknown) {
  await teacherOf(ctx, offeringId);
  const v = z.object({ column: z.string().regex(/^[aql]:[a-z0-9]+$/i), componentId: z.string().min(1) }).parse(raw);
  const comp = await db.assessmentComponent.findFirst({ where: { id: v.componentId, offeringId } });
  if (!comp) throw invalid("Choose an assessment component of this class.");
  const gb = await gradebook(ctx, offeringId);
  const col = gb.columns.find((c) => c.key === v.column);
  if (!col) throw invalid("Choose a published assignment or quiz.");
  const entries = gb.rows.filter((r) => r.cells[col.key] !== null).map((r) => ({ studentId: r.student.id, marks: scaleScore(r.cells[col.key]!, col.max, comp.maxMarks), status: "PRESENT" as const }));
  const r = await saveMarks(ctx, comp.id, { entries });
  await audit({ ...actor(ctx), action: "lms.gradebook.transfer", resourceType: "assessmentComponent", resourceId: comp.id, summary: `${col.title} (out of ${col.max}) → ${comp.name} (out of ${comp.maxMarks}): ${entries.length} score(s), ${gb.rows.length - entries.length} blank` });
  return { transferred: entries.length, blank: gb.rows.length - entries.length, changed: r.changed };
}
