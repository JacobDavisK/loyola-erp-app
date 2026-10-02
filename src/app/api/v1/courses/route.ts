import { page, v1 } from "@/server/api-v1";
import { listCourses } from "@/server/services/open-api";

export const GET = v1("academics:read", ({ ctx, query }) => listCourses(ctx, { q: query.get("q") ?? undefined, ...page(query) }));
