import { api, body } from "@/server/api";
import { createQuestion, searchQuestions } from "@/server/services/questions";

/** GET /api/questions?q=&courseId=&marks=&difficulty=&bloom=&type=&unit=&page=&pageSize= */
export const GET = api(async ({ req, ctx }) => {
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const res = await searchQuestions(ctx, sp);
  return { ...res, rows: res.rows.map(({ versions, ...r }) => ({ ...r, body: versions[0]?.body })) };
}, { perm: "question.view" });

/** POST /api/questions — create (body: QuestionInput). */
export const POST = api(async ({ req, ctx }) => {
  const q = await createQuestion(ctx, await body(req));
  return { id: q.id, code: q.code, status: q.status };
}, { perm: "question.create" });
