import { api } from "@/server/api";
import { buildReport } from "@/server/services/reports";

/** GET /api/question-bank — bank composition by course, difficulty, Bloom level and unit (caller's scope). */
export const GET = api(async ({ ctx }) => buildReport(ctx, "question-bank"), { perm: "question.view" });
