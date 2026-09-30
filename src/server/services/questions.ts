import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { BloomLevel, Difficulty, QuestionStatus, QuestionType } from "@/generated/prisma/enums";
import { collectMath, toPlainText } from "@/lib/content/parse";
import { compareQuestions } from "@/lib/domain/similarity";
import { authorableCourseWhere, questionWhere } from "@/server/auth/access";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, invalid, notFound } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { validateMath } from "@/server/services/papers";
import { getSetting } from "@/server/services/settings";

// ───────────────────────── Search ─────────────────────────

export const questionFilterSchema = z.object({
  q: z.string().max(200).optional(),
  courseId: z.string().optional(),
  unit: z.coerce.number().int().optional(),
  topicId: z.string().optional(),
  outcomeId: z.string().optional(),
  marks: z.coerce.number().int().optional(),
  difficulty: z.enum(Difficulty).optional(),
  bloom: z.enum(BloomLevel).optional(),
  type: z.enum(QuestionType).optional(),
  status: z.enum(QuestionStatus).optional(),
  tag: z.string().optional(),
  authorId: z.string().optional(),
  usage: z.enum(["never", "used", "frequent"]).optional(),
  from: z.string().optional(),
  sort: z.enum(["relevance", "newest", "oldest", "most-used", "least-used", "marks"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(5).max(100).optional(),
  excludeIds: z.array(z.string()).optional(),
});
export type QuestionFilters = z.infer<typeof questionFilterSchema>;

export const QUESTION_LIST_SELECT = {
  id: true,
  code: true,
  plainText: true,
  type: true,
  marks: true,
  difficulty: true,
  bloom: true,
  status: true,
  usageCount: true,
  lastUsedAt: true,
  lastUsedSessionId: true,
  estimatedMinutes: true,
  currentVersion: true,
  createdAt: true,
  updatedAt: true,
  course: { select: { id: true, code: true, title: true } },
  unit: { select: { number: true, title: true } },
  topic: { select: { title: true } },
  outcome: { select: { code: true } },
  author: { select: { name: true } },
  tags: { select: { tag: { select: { name: true } } } },
  versions: { orderBy: { version: "desc" }, take: 1, select: { id: true, version: true, body: true, options: true } },
} satisfies Prisma.QuestionSelect;

export type QuestionListRow = Prisma.QuestionGetPayload<{ select: typeof QUESTION_LIST_SELECT }>;

/**
 * Server-side search: scope → filters → full-text (tsvector/GIN) with a trigram fallback for
 * partial words and question codes. Always paginated; the bank is never sent wholesale to the browser.
 */
export async function searchQuestions(ctx: AuthContext, raw: unknown) {
  const f = questionFilterSchema.parse(raw);
  const page = f.page ?? 1;
  const pageSize = f.pageSize ?? 25;
  const where: Prisma.QuestionWhereInput[] = [questionWhere(ctx)];
  where.push({ status: f.status ?? { not: "RETIRED" } });
  if (f.courseId) where.push({ courseId: f.courseId });
  if (f.unit) where.push({ unit: { number: f.unit } });
  if (f.topicId) where.push({ topicId: f.topicId });
  if (f.outcomeId) where.push({ outcomeId: f.outcomeId });
  if (f.marks) where.push({ marks: f.marks });
  if (f.difficulty) where.push({ difficulty: f.difficulty });
  if (f.bloom) where.push({ bloom: f.bloom });
  if (f.type) where.push({ type: f.type });
  if (f.tag) where.push({ tags: { some: { tag: { name: f.tag } } } });
  if (f.authorId) where.push({ authorId: f.authorId });
  if (f.usage === "never") where.push({ usageCount: 0 });
  if (f.usage === "used") where.push({ usageCount: { gt: 0 } });
  if (f.usage === "frequent") where.push({ usageCount: { gte: 2 } });
  if (f.from) where.push({ createdAt: { gte: new Date(f.from) } });
  if (f.excludeIds?.length) where.push({ id: { notIn: f.excludeIds } });

  let rankedIds: string[] | null = null;
  const text = f.q?.trim();
  if (text) {
    if (/^q-?\d+$/i.test(text)) {
      where.push({ code: { contains: text.replace(/^q-?/i, ""), mode: "insensitive" } });
    } else {
      // Full-text ranking with prefix matching on the last word; trigram similarity as a fallback.
      const words = text.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean).slice(0, 8);
      const tsquery = words.map((w, i) => (i === words.length - 1 ? `${w}:*` : w)).join(" & ");
      const rows = await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Question"
        WHERE "deletedAt" IS NULL AND (
          search @@ to_tsquery('english', ${tsquery})
          OR ${text} <% "plainText"
          OR "plainText" ILIKE ${"%" + text + "%"}
        )
        ORDER BY ts_rank(search, to_tsquery('english', ${tsquery})) DESC, word_similarity(${text}, "plainText") DESC
        LIMIT 2000`;
      rankedIds = rows.map((r) => r.id);
      where.push({ id: { in: rankedIds } });
    }
  }

  const orderBy: Prisma.QuestionOrderByWithRelationInput[] =
    f.sort === "oldest" ? [{ createdAt: "asc" }]
    : f.sort === "most-used" ? [{ usageCount: "desc" }, { createdAt: "desc" }]
    : f.sort === "least-used" ? [{ usageCount: "asc" }, { createdAt: "desc" }]
    : f.sort === "marks" ? [{ marks: "asc" }, { code: "asc" }]
    : [{ createdAt: "desc" }];

  const fullWhere: Prisma.QuestionWhereInput = { AND: where };
  if (rankedIds && (!f.sort || f.sort === "relevance")) {
    // keep relevance order: fetch the matching ids in scope, then page in rank order
    const allowed = await db.question.findMany({ where: fullWhere, select: { id: true } });
    const allowedSet = new Set(allowed.map((a) => a.id));
    const ordered = rankedIds.filter((id) => allowedSet.has(id));
    const pageIds = ordered.slice((page - 1) * pageSize, page * pageSize);
    const rows = await db.question.findMany({ where: { id: { in: pageIds } }, select: QUESTION_LIST_SELECT });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return { rows: pageIds.map((id) => byId.get(id)!).filter(Boolean), total: ordered.length, page, pageSize };
  }
  const [rows, total] = await Promise.all([
    db.question.findMany({ where: fullWhere, select: QUESTION_LIST_SELECT, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
    db.question.count({ where: fullWhere }),
  ]);
  return { rows, total, page, pageSize };
}

export async function getQuestion(ctx: AuthContext, id: string) {
  const q = await db.question.findFirst({
    where: { AND: [questionWhere(ctx), { id }] },
    include: {
      course: { select: { id: true, code: true, title: true, departmentId: true } },
      unit: true,
      topic: true,
      outcome: true,
      author: { select: { id: true, name: true } },
      tags: { include: { tag: true } },
      versions: { orderBy: { version: "desc" }, include: { createdBy: { select: { name: true } } } },
      usages: {
        orderBy: { usedAt: "desc" },
        include: { paper: { select: { id: true, code: true } }, examination: { select: { session: { select: { name: true, code: true } } } } },
      },
    },
  });
  if (!q) throw notFound("Question");
  return q;
}

// ───────────────────────── Authoring ─────────────────────────

const optionsSchema = z
  .object({
    choices: z.array(z.object({ label: z.string().max(4), text: z.string().trim().min(1).max(500), correct: z.boolean().optional() })).max(8).optional(),
    pairs: z.array(z.object({ left: z.string().trim().min(1).max(300), right: z.string().trim().min(1).max(300) })).max(12).optional(),
  })
  .nullable()
  .optional();

export const questionInputSchema = z
  .object({
    courseId: z.string().min(1, "Choose a course"),
    unitId: z.string().min(1, "Choose a unit"),
    topicId: z.string().nullable().optional(),
    outcomeId: z.string().nullable().optional(),
    type: z.enum(QuestionType),
    bloom: z.enum(BloomLevel),
    difficulty: z.enum(Difficulty),
    marks: z.number().int().min(1).max(100),
    estimatedMinutes: z.number().int().min(1).max(240),
    body: z.string().trim().min(5, "Question text is too short").max(20000),
    options: optionsSchema,
    answerKey: z.string().max(10000).nullable().optional(),
    keywords: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
    changeNote: z.string().max(300).optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.type === "MCQ" || v.type === "ASSERTION_REASON") && (v.options?.choices?.length ?? 0) < 2) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Add at least two answer choices" });
    }
    if (v.type === "MCQ" && v.options?.choices && !v.options.choices.some((c) => c.correct)) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Mark the correct choice" });
    }
    if (v.type === "MATCH" && (v.options?.pairs?.length ?? 0) < 2) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "Add at least two pairs" });
    }
    for (const tex of collectMath(v.body)) {
      const err = validateMath(tex);
      if (err) {
        ctx.addIssue({ code: "custom", path: ["body"], message: `Equation error: ${err}` });
        break;
      }
    }
  });
export type QuestionInput = z.infer<typeof questionInputSchema>;

async function assertCourseStructure(input: QuestionInput) {
  const unit = await db.courseUnit.findFirst({ where: { id: input.unitId, courseId: input.courseId } });
  if (!unit) throw invalid("The unit does not belong to the selected course.");
  if (input.topicId && !(await db.courseTopic.findFirst({ where: { id: input.topicId, unitId: input.unitId } }))) throw invalid("The topic does not belong to the selected unit.");
  if (input.outcomeId && !(await db.learningOutcome.findFirst({ where: { id: input.outcomeId, courseId: input.courseId } }))) throw invalid("The outcome does not belong to the selected course.");
}

async function nextQuestionCode(): Promise<string> {
  const [{ max }] = await db.$queryRaw<{ max: number | null }[]>`SELECT MAX(CAST(SUBSTRING(code FROM 3) AS INTEGER)) AS max FROM "Question"`;
  return `Q-${String((max ?? 0) + 1).padStart(6, "0")}`;
}

async function upsertTags(names: string[]) {
  const unique = [...new Set(names.map((n) => n.toLowerCase()))];
  const out: string[] = [];
  for (const name of unique) out.push((await db.tag.upsert({ where: { name }, create: { name }, update: {} })).id);
  return out;
}

export async function createQuestion(ctx: AuthContext, raw: unknown) {
  if (!can(ctx, "question.create")) throw forbidden();
  const input = questionInputSchema.parse(raw);
  const course = await db.course.findFirst({ where: { AND: [authorableCourseWhere(ctx), { id: input.courseId }] } });
  if (!course) throw forbidden("You cannot add questions to this course.");
  await assertCourseStructure(input);
  const plain = toPlainText(input.body);
  const tagIds = await upsertTags(input.tags);
  // Questions from users who cannot review go to the review queue first.
  const status = can(ctx, "question.review", course.departmentId) ? "ACTIVE" : "PENDING_REVIEW";

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const q = await db.$transaction(async (tx) => {
        const created = await tx.question.create({
          data: {
            code: await nextQuestionCode(),
            courseId: input.courseId,
            unitId: input.unitId,
            topicId: input.topicId || null,
            outcomeId: input.outcomeId || null,
            type: input.type,
            bloom: input.bloom,
            difficulty: input.difficulty,
            marks: input.marks,
            estimatedMinutes: input.estimatedMinutes,
            status,
            authorId: ctx.user.id,
            plainText: plain,
            searchText: `${plain} ${input.keywords.join(" ")} ${input.tags.join(" ")}`,
            keywords: input.keywords,
            versions: {
              create: {
                version: 1,
                body: input.body,
                options: (input.options ?? undefined) as Prisma.InputJsonValue | undefined,
                answerKey: input.answerKey ?? null,
                marks: input.marks,
                difficulty: input.difficulty,
                bloom: input.bloom,
                type: input.type,
                createdById: ctx.user.id,
                changeNote: "Initial version",
              },
            },
            tags: { create: tagIds.map((tagId) => ({ tagId })) },
          },
        });
        await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "question.create", resourceType: "question", resourceId: created.id, summary: `${created.code} created (${status.toLowerCase().replace("_", " ")})`, newValue: { code: created.code, marks: input.marks, courseId: input.courseId } }, tx);
        return created;
      });
      return q;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 2) continue; // code race, retry
      throw e;
    }
  }
  throw new Error("unreachable");
}

async function editableQuestion(ctx: AuthContext, id: string) {
  const q = await db.question.findFirst({ where: { AND: [questionWhere(ctx), { id }] }, include: { course: { select: { departmentId: true } } } });
  if (!q) throw notFound("Question");
  const own = q.authorId === ctx.user.id && can(ctx, "question.edit.own");
  const any = can(ctx, "question.edit.any", q.course.departmentId);
  if (!own && !any) throw forbidden("You can edit only questions you authored.");
  return q;
}

/** Editing never overwrites: it appends an immutable version. Papers keep referencing the version they used. */
export async function updateQuestion(ctx: AuthContext, id: string, raw: unknown) {
  const q = await editableQuestion(ctx, id);
  if (q.status === "RETIRED") throw invalid("Retired questions cannot be edited. Restore it first.");
  const input = questionInputSchema.parse(raw);
  if (input.courseId !== q.courseId) throw invalid("A question cannot be moved to another course; create a new one instead.");
  await assertCourseStructure(input);
  const plain = toPlainText(input.body);
  const tagIds = await upsertTags(input.tags);
  const before = await db.questionVersion.findFirstOrThrow({ where: { questionId: id }, orderBy: { version: "desc" } });
  return db.$transaction(async (tx) => {
    const version = q.currentVersion + 1;
    await tx.questionVersion.create({
      data: {
        questionId: id,
        version,
        body: input.body,
        options: (input.options ?? undefined) as Prisma.InputJsonValue | undefined,
        answerKey: input.answerKey ?? null,
        marks: input.marks,
        difficulty: input.difficulty,
        bloom: input.bloom,
        type: input.type,
        createdById: ctx.user.id,
        changeNote: input.changeNote || "Edited",
      },
    });
    await tx.questionTag.deleteMany({ where: { questionId: id } });
    const updated = await tx.question.update({
      where: { id },
      data: {
        unitId: input.unitId,
        topicId: input.topicId || null,
        outcomeId: input.outcomeId || null,
        type: input.type,
        bloom: input.bloom,
        difficulty: input.difficulty,
        marks: input.marks,
        estimatedMinutes: input.estimatedMinutes,
        plainText: plain,
        searchText: `${plain} ${input.keywords.join(" ")} ${input.tags.join(" ")}`,
        keywords: input.keywords,
        currentVersion: version,
        tags: { create: tagIds.map((tagId) => ({ tagId })) },
      },
    });
    await audit(
      {
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        action: "question.update",
        resourceType: "question",
        resourceId: id,
        summary: `${q.code} → v${version}${input.changeNote ? `: ${input.changeNote}` : ""}`,
        oldValue: { version: before.version, marks: before.marks, difficulty: before.difficulty, bloom: before.bloom, body: before.body.slice(0, 500) },
        newValue: { version, marks: input.marks, difficulty: input.difficulty, bloom: input.bloom, body: input.body.slice(0, 500) },
      },
      tx,
    );
    return updated;
  });
}

/** Retirement is a soft delete: historical papers and usage history keep referencing the question. */
export async function setQuestionStatus(ctx: AuthContext, id: string, status: "ACTIVE" | "RETIRED") {
  const q = await db.question.findFirst({ where: { AND: [questionWhere(ctx), { id }] }, include: { course: true } });
  if (!q) throw notFound("Question");
  const allowed =
    status === "RETIRED"
      ? can(ctx, "question.retire", q.course.departmentId) || (q.authorId === ctx.user.id && q.usageCount === 0 && can(ctx, "question.edit.own"))
      : can(ctx, "question.review", q.course.departmentId) || can(ctx, "question.retire", q.course.departmentId);
  if (!allowed) throw forbidden();
  await db.question.update({ where: { id }, data: { status } });
  await audit({
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: status === "RETIRED" ? "question.delete" : q.status === "PENDING_REVIEW" ? "question.approve" : "question.restore",
    resourceType: "question",
    resourceId: id,
    summary: `${q.code}: ${q.status} → ${status}`,
    oldValue: { status: q.status },
    newValue: { status },
  });
}

export interface SimilarQuestion {
  id: string;
  code: string;
  text: string;
  similarity: number;
  kind: string;
  usedIn: string[];
}

/** Near-duplicate lookup used while authoring and in the moderation panel. */
export async function findSimilarQuestions(ctx: AuthContext, courseId: string, text: string, excludeId?: string): Promise<SimilarQuestion[]> {
  const plain = toPlainText(text);
  if (plain.length < 12) return [];
  const threshold = (await getSetting("workflow")).duplicateThreshold;
  const candidates = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Question"
    WHERE "courseId" = ${courseId} AND "deletedAt" IS NULL AND id <> ${excludeId ?? ""}
      AND ("plainText" % ${plain} OR search @@ plainto_tsquery('english', ${plain}))
    ORDER BY similarity("plainText", ${plain}) DESC
    LIMIT 40`;
  if (!candidates.length) return [];
  const rows = await db.question.findMany({
    where: { AND: [questionWhere(ctx), { id: { in: candidates.map((c) => c.id) } }] },
    select: { id: true, code: true, plainText: true, topic: { select: { title: true } }, usages: { select: { examination: { select: { session: { select: { name: true } } } } } } },
  });
  return rows
    .map((r) => {
      const res = compareQuestions({ text: plain }, { text: r.plainText, topic: r.topic?.title });
      return { id: r.id, code: r.code, text: r.plainText, similarity: res.score, kind: res.kind, usedIn: [...new Set(r.usages.map((u) => u.examination.session.name))] };
    })
    .filter((r) => r.similarity >= threshold * 0.85 || r.kind !== "distinct")
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 6);
}

/** Builder-ready item data (latest version) for the given question ids, limited to the caller's scope. */
export async function builderQuestions(ctx: AuthContext, courseId: string, ids: string[]) {
  const rows = await db.question.findMany({
    where: { AND: [questionWhere(ctx), { id: { in: ids.slice(0, 200) }, courseId }] },
    select: QUESTION_LIST_SELECT,
  });
  return rows.map(toBuilderItem);
}

export function toBuilderItem(q: QuestionListRow) {
  const v = q.versions[0];
  return {
    itemId: `new-${q.id}`,
    questionId: q.id,
    questionCode: q.code,
    versionId: v.id,
    version: v.version,
    body: v.body,
    options: (v.options as import("@/lib/domain/paper-types").QuestionOptionData | null) ?? null,
    marks: q.marks,
    type: q.type,
    difficulty: q.difficulty,
    bloom: q.bloom,
    unitNumber: q.unit.number,
    unitTitle: q.unit.title,
    outcomeCode: q.outcome?.code ?? null,
    topic: q.topic?.title ?? null,
  };
}
