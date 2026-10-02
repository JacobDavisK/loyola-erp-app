import { v1 } from "@/server/api-v1";
import { selfSummary } from "@/server/services/open-api";

/** Attendance, results and fee balance for the student (or, for a guardian, ?student=<id> of a ward). */
export const GET = v1("self:read", ({ ctx, query }) => selfSummary(ctx, query.get("student") ?? undefined));
