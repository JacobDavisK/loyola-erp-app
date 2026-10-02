import "server-only";
import { z } from "zod";
import type { Asset } from "@/generated/prisma/client";
import { depreciation, depreciationForYear, fiscalYearRange } from "@/lib/domain/operations";
import { fromMinor, toMinor } from "@/lib/domain/money";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { postJournal } from "@/server/services/ledger";
import { nextNumber } from "@/server/services/sequence";
import { getSetting } from "@/server/services/settings";

/**
 * Fixed-asset register. Assets arrive from goods receipts or are entered for existing equipment; they are
 * transferred between departments, physically verified, repaired and disposed of, each step recorded in an
 * append-only history. Depreciation (straight-line or written-down value) is computed for any date and
 * posted to the ledger once per financial year, per department.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });
const assertManage = (ctx: AuthContext) => {
  if (!can(ctx, "asset.manage")) throw forbidden();
};

export const asDepreciable = (a: Asset) => ({ cost: Number(a.cost), salvageValue: Number(a.salvageValue), usefulLifeYears: a.usefulLifeYears, method: a.method, wdvRate: a.wdvRate, purchaseDate: a.purchaseDate });

const assetSchema = z.object({
  name: z.string().trim().min(2).max(200),
  category: z.string().trim().min(2).max(60),
  departmentId: z.string(),
  location: z.string().trim().max(200).nullable().optional(),
  serialNo: z.string().trim().max(80).nullable().optional(),
  purchaseDate: z.coerce.date(),
  cost: z.number().min(0).max(1e11),
  salvageValue: z.number().min(0).default(0),
  usefulLifeYears: z.number().positive().max(100),
  method: z.enum(["STRAIGHT_LINE", "WRITTEN_DOWN_VALUE"]),
  wdvRate: z.number().positive().max(99).nullable().optional(),
});

export async function saveAsset(ctx: AuthContext, id: string | null, raw: unknown) {
  assertManage(ctx);
  const v = assetSchema.parse(raw);
  if (v.salvageValue > v.cost) throw invalid("The salvage value cannot exceed the cost.");
  if (v.method === "WRITTEN_DOWN_VALUE" && !v.wdvRate) throw invalid("Give the written-down-value rate.");
  const data = { ...v, cost: fromMinor(Math.round(v.cost * 100)), salvageValue: fromMinor(Math.round(v.salvageValue * 100)), wdvRate: v.method === "WRITTEN_DOWN_VALUE" ? v.wdvRate ?? null : null, location: v.location ?? null, serialNo: v.serialNo ?? null };
  if (id) {
    const a = await db.asset.update({ where: { id }, data });
    await db.assetEvent.create({ data: { assetId: id, kind: "UPDATED", note: "Details corrected", actorId: ctx.user.id } });
    return a;
  }
  const ops = await getSetting("operations");
  return db.$transaction(async (tx) => {
    const a = await tx.asset.create({ data: { ...data, tag: await nextNumber(tx, "asset.tag", { prefix: ops.assetTagPrefix, padding: 5 }) } });
    await tx.assetEvent.create({ data: { assetId: a.id, kind: "ACQUIRED", note: "Entered in the register", actorId: ctx.user.id } });
    return a;
  });
}

export async function transferAsset(ctx: AuthContext, id: string, raw: unknown) {
  assertManage(ctx);
  const v = z.object({ departmentId: z.string(), location: z.string().trim().max(200).nullable().optional(), note: z.string().trim().max(300).nullable().optional() }).parse(raw);
  const a = await db.asset.findUnique({ where: { id }, include: { department: true } });
  if (!a) throw notFound("Asset");
  if (a.status === "DISPOSED") throw workflowError("A disposed asset cannot be moved.");
  const to = await db.department.findUniqueOrThrow({ where: { id: v.departmentId } });
  await db.$transaction(async (tx) => {
    await tx.asset.update({ where: { id }, data: { departmentId: v.departmentId, location: v.location ?? a.location } });
    await tx.assetEvent.create({ data: { assetId: id, kind: "TRANSFER", note: `${a.department.code} → ${to.code}${v.location ? `, ${v.location}` : ""}${v.note ? ` — ${v.note}` : ""}`, actorId: ctx.user.id } });
  });
}

export async function recordAssetEvent(ctx: AuthContext, id: string, raw: unknown) {
  assertManage(ctx);
  const v = z.object({ kind: z.enum(["VERIFIED", "REPAIR", "RETURNED_TO_USE", "IDLE", "LOST"]), note: z.string().trim().min(3).max(500) }).parse(raw);
  const a = await db.asset.findUnique({ where: { id } });
  if (!a) throw notFound("Asset");
  if (a.status === "DISPOSED") throw workflowError("The asset has been disposed of.");
  const status = { VERIFIED: a.status, REPAIR: "IN_REPAIR", RETURNED_TO_USE: "IN_USE", IDLE: "IDLE", LOST: "LOST" }[v.kind] as Asset["status"];
  await db.$transaction(async (tx) => {
    await tx.asset.update({ where: { id }, data: { status } });
    await tx.assetEvent.create({ data: { assetId: id, kind: v.kind, note: v.note, actorId: ctx.user.id } });
  });
}

/** Disposal: the asset leaves the books at its depreciated value; the difference from the sale is a loss or gain. */
export async function disposeAsset(ctx: AuthContext, id: string, raw: unknown) {
  assertManage(ctx);
  const v = z.object({ date: z.coerce.date(), value: z.number().min(0), note: z.string().trim().min(5).max(500) }).parse(raw);
  const a = await db.asset.findUnique({ where: { id } });
  if (!a) throw notFound("Asset");
  if (a.status === "DISPOSED") throw conflict("Already disposed.");
  const dep = depreciation(asDepreciable(a), v.date);
  const cost = toMinor(a.cost);
  const accumulated = Math.round(dep.accumulated * 100);
  const proceeds = Math.round(v.value * 100);
  const loss = cost - accumulated - proceeds; // positive = loss, negative = gain
  await db.$transaction(async (tx) => {
    await tx.asset.update({ where: { id }, data: { status: "DISPOSED", disposedAt: v.date, disposalValue: fromMinor(proceeds) } });
    await tx.assetEvent.create({ data: { assetId: id, kind: "DISPOSED", note: `${v.note} — book value ${dep.bookValue.toFixed(2)}, realised ${v.value.toFixed(2)}`, actorId: ctx.user.id } });
    await postJournal(tx, { date: v.date, memo: `Disposal of asset ${a.tag} ${a.name}`, sourceType: "assetDisposal", sourceId: id, postedById: ctx.user.id }, [
      { account: "ACCUMULATED_DEPRECIATION", debit: accumulated },
      { account: "BANK", debit: proceeds },
      { account: "ASSET_DISPOSAL", debit: loss > 0 ? loss : 0, credit: loss < 0 ? -loss : 0, departmentId: a.departmentId },
      { account: "FIXED_ASSETS", credit: cost },
    ]);
    await audit({ ...actor(ctx), action: "asset.dispose", resourceType: "asset", resourceId: id, summary: `${a.tag}: ${loss >= 0 ? "loss" : "gain"} ${(Math.abs(loss) / 100).toFixed(2)}` }, tx);
  });
}

/** Depreciation schedule for a financial year, per asset and per department. */
export async function depreciationSchedule(fy: string) {
  const { from, to } = fiscalYearRange(fy);
  const assets = await db.asset.findMany({ where: { purchaseDate: { lt: to }, OR: [{ disposedAt: null }, { disposedAt: { gte: from } }] }, include: { department: { select: { id: true, code: true } } }, orderBy: { tag: "asc" } });
  const rows = assets.map((a) => ({ asset: a, charge: depreciationForYear(asDepreciable(a), fy, a.disposedAt), closing: depreciation(asDepreciable(a), a.disposedAt && a.disposedAt < to ? a.disposedAt : to).bookValue }));
  const byDept = new Map<string, { code: string; charge: number }>();
  for (const r of rows) {
    const d = byDept.get(r.asset.department.id) ?? byDept.set(r.asset.department.id, { code: r.asset.department.code, charge: 0 }).get(r.asset.department.id)!;
    d.charge = Math.round((d.charge + r.charge) * 100) / 100;
  }
  const posted = await db.journalEntry.findFirst({ where: { sourceType: "depreciation", sourceId: fy } });
  return { fy, rows, byDept: [...byDept.entries()].map(([id, v]) => ({ departmentId: id, ...v })), posted };
}

export async function postDepreciation(ctx: AuthContext, fy: string) {
  if (!can(ctx, "budget.manage") && !can(ctx, "asset.manage")) throw forbidden();
  const s = await depreciationSchedule(fy);
  if (s.posted) throw conflict(`Depreciation for ${fy} was posted in ${s.posted.number}.`);
  const total = s.byDept.reduce((a, d) => a + Math.round(d.charge * 100), 0);
  if (!total) throw workflowError("There is no depreciation to post.");
  const { to } = fiscalYearRange(fy);
  await db.$transaction(async (tx) => {
    await postJournal(tx, { date: new Date(Math.min(to.getTime() - 86_400_000, Date.now())), memo: `Depreciation for ${fy}`, sourceType: "depreciation", sourceId: fy, postedById: ctx.user.id }, [
      ...s.byDept.filter((d) => d.charge > 0).map((d) => ({ account: "DEPRECIATION_EXPENSE" as const, debit: Math.round(d.charge * 100), departmentId: d.departmentId })),
      { account: "ACCUMULATED_DEPRECIATION", credit: total },
    ]);
    await audit({ ...actor(ctx), action: "asset.depreciation", resourceType: "journal", resourceId: fy, summary: `${fy}: ${(total / 100).toFixed(2)}` }, tx);
  });
}
