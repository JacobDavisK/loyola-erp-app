import { api } from "@/server/api";
import { can } from "@/server/auth/current";
import { REPORT_KINDS } from "@/server/services/reports";

/** GET /api/reports — available reports; fetch one as /api/reports/:kind?format=csv|xlsx|pdf */
export const GET = api(async ({ ctx }) => REPORT_KINDS.filter((k) => can(ctx, k.perm)).map((k) => ({ kind: k.key, label: k.label, formats: ["csv", "xlsx", "pdf"], href: `/api/reports/${k.key}` })));
