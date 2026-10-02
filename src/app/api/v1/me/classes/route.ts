import { v1 } from "@/server/api-v1";
import { upcomingClasses } from "@/server/services/open-api";

export const GET = v1("self:read", ({ ctx, query }) => upcomingClasses(ctx, Math.min(31, Math.max(1, Number(query.get("days")) || 7))));
