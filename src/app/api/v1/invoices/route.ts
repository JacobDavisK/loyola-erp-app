import { page, v1 } from "@/server/api-v1";
import { listInvoices } from "@/server/services/open-api";

export const GET = v1("finance:read", ({ ctx, query }) => listInvoices(ctx, { status: query.get("status") ?? undefined, studentId: query.get("student") ?? undefined, ...page(query) }));
