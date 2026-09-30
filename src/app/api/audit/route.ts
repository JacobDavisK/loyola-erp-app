import { api } from "@/server/api";
import { db } from "@/server/db";
import { verifyAuditChain } from "@/server/services/audit";

/** GET /api/audit?action=&limit= — recent audit entries; ?verify=1 recomputes the hash chain. */
export const GET = api(async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  if (sp.get("verify")) return verifyAuditChain();
  const action = sp.get("action");
  const rows = await db.auditLog.findMany({ where: action ? { action: { startsWith: action } } : {}, orderBy: { id: "desc" }, take: Math.min(500, Number(sp.get("limit")) || 100) });
  return rows.map((r) => ({ ...r, id: r.id.toString() }));
}, { perm: "audit.view" });
