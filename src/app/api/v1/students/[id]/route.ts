import { v1 } from "@/server/api-v1";
import { getStudent } from "@/server/services/open-api";

export const GET = v1<{ id: string }>("students:read", ({ ctx, params }) => getStudent(ctx, params.id));
