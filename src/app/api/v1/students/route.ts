import { page, v1 } from "@/server/api-v1";
import { listStudents } from "@/server/services/open-api";

export const GET = v1("students:read", ({ ctx, query }) => listStudents(ctx, { q: query.get("q") ?? undefined, departmentId: query.get("department") ?? undefined, status: query.get("status") ?? undefined, ...page(query) }));
