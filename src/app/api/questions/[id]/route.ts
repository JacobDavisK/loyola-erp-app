import { api, body } from "@/server/api";
import { getQuestion, setQuestionStatus, updateQuestion } from "@/server/services/questions";

export const GET = api<{ id: string }>(async ({ ctx, params }) => getQuestion(ctx, params.id), { perm: "question.view" });

/** PATCH /api/questions/:id — creates a new immutable version. */
export const PATCH = api<{ id: string }>(async ({ req, ctx, params }) => {
  const q = await updateQuestion(ctx, params.id, await body(req));
  return { id: q.id, version: q.currentVersion };
});

/** DELETE /api/questions/:id — retire (soft delete); history is preserved. */
export const DELETE = api<{ id: string }>(async ({ ctx, params }) => {
  await setQuestionStatus(ctx, params.id, "RETIRED");
  return { retired: true };
});
