import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { definitionSchema } from "@/lib/domain/report";
import { toCsv } from "@/lib/domain/csv";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, notFound } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { datasetByKey } from "@/server/reports/datasets";
import { runReport } from "@/server/reports/engine";

/**
 * Saved reports: private to the owner, or shared with everyone who can read the dataset. A shared report
 * runs with the viewer's own scope, so sharing a definition never shares data beyond what the viewer may see.
 */

export async function saveReport(ctx: AuthContext, id: string | null, raw: unknown) {
  const v = z.object({ name: z.string().trim().min(3).max(120), shared: z.boolean().default(false), definition: definitionSchema }).parse(raw);
  const ds = datasetByKey(v.definition.dataset);
  if (!ds || !can(ctx, ds.permission)) throw forbidden();
  await runReport(ctx, { ...v.definition, limit: 1 }); // validates the definition end to end
  const data = { name: v.name, shared: v.shared, dataset: v.definition.dataset, definition: v.definition as Prisma.InputJsonValue };
  if (id) {
    const cur = await db.savedReport.findUnique({ where: { id } });
    if (!cur || cur.ownerId !== ctx.user.id) throw notFound("Report");
  }
  const r = id ? await db.savedReport.update({ where: { id }, data }) : await db.savedReport.create({ data: { ...data, ownerId: ctx.user.id } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: id ? "report.update" : "report.create", resourceType: "savedReport", resourceId: r.id, summary: `${r.name} (${r.dataset}${r.shared ? ", shared" : ""})` });
  return r;
}

export async function deleteReport(ctx: AuthContext, id: string) {
  const r = await db.savedReport.findUnique({ where: { id } });
  if (!r || r.ownerId !== ctx.user.id) throw notFound("Report");
  await db.savedReport.delete({ where: { id } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "report.delete", resourceType: "savedReport", resourceId: id, summary: r.name });
}

export async function reportsFor(ctx: AuthContext) {
  const list = await db.savedReport.findMany({ where: { OR: [{ ownerId: ctx.user.id }, { shared: true }] }, orderBy: { updatedAt: "desc" }, include: { owner: { select: { name: true } } } });
  return list.filter((r) => { const ds = datasetByKey(r.dataset); return ds && can(ctx, ds.permission); });
}

export async function loadReportFor(ctx: AuthContext, id: string) {
  const r = await db.savedReport.findUnique({ where: { id } });
  if (!r || (r.ownerId !== ctx.user.id && !r.shared)) throw notFound("Report");
  const ds = datasetByKey(r.dataset);
  if (!ds || !can(ctx, ds.permission)) throw notFound("Report");
  return r;
}

/** CSV export (formula-injection safe), audited — personal-data exports are flagged in the log. */
export async function exportCsv(ctx: AuthContext, raw: unknown, name: string) {
  const def = definitionSchema.parse(raw);
  const result = await runReport(ctx, { ...def, limit: 5000 });
  const csv = toCsv(result.columns.map((c) => c.label), result.rows.map((r) => result.columns.map((c) => { const v = r[c.key]; return v instanceof Date ? v.toISOString().slice(0, 10) : v; })));
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "report.export", resourceType: "report", resourceId: def.dataset, summary: `${name}: ${result.rows.length} row(s)${result.personal ? " — contains personal data" : ""}`, newValue: { definition: def } });
  return { csv, rows: result.rows.length };
}
