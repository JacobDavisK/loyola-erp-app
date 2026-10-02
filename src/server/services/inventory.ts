import "server-only";
import { z } from "zod";
import { averageCost } from "@/lib/domain/operations";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { postJournal } from "@/server/services/ledger";

/**
 * Stores. The stock ledger is append-only: receipts (from goods receipts), issues to departments,
 * transfers between stores and count adjustments. Issues are valued at weighted-average cost and post
 * "stores consumed" to the receiving department, so stationery and lab consumables count against its
 * budget. The database refuses any movement that would take a store's stock below zero.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });
const assertManage = (ctx: AuthContext) => {
  if (!can(ctx, "inventory.manage")) throw forbidden();
};

export async function saveStore(ctx: AuthContext, id: string | null, raw: unknown) {
  assertManage(ctx);
  const v = z.object({ name: z.string().trim().min(2).max(120), location: z.string().trim().max(200).nullable().optional(), keeperId: z.string().nullable().optional() }).parse(raw);
  return id ? db.store.update({ where: { id }, data: { ...v, keeperId: v.keeperId || null } }) : db.store.create({ data: { ...v, keeperId: v.keeperId || null } });
}

export async function saveItem(ctx: AuthContext, id: string | null, raw: unknown) {
  if (!can(ctx, "inventory.manage") && !can(ctx, "procurement.manage")) throw forbidden();
  const v = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,30}$/), name: z.string().trim().min(2).max(200), unit: z.string().trim().min(1).max(20), category: z.string().trim().min(2).max(60), reorderLevel: z.number().min(0).default(0), active: z.boolean().default(true) }).parse(raw);
  if (await db.stockItem.findFirst({ where: { code: v.code, ...(id ? { id: { not: id } } : {}) } })) throw conflict("This item code exists.");
  return id ? db.stockItem.update({ where: { id }, data: v }) : db.stockItem.create({ data: v });
}

async function position(itemId: string, storeId: string) {
  const moves = await db.stockMovement.findMany({ where: { itemId, storeId }, orderBy: { createdAt: "asc" }, select: { quantity: true, unitCost: true } });
  return averageCost(moves.map((m) => ({ quantity: m.quantity, unitCost: Number(m.unitCost) })));
}

/** Stock on hand per item and store, with value and reorder flag. */
export async function stockLevels() {
  const [items, stores, groups] = await Promise.all([
    db.stockItem.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    db.store.findMany({ orderBy: { name: "asc" } }),
    db.stockMovement.groupBy({ by: ["itemId", "storeId"], _sum: { quantity: true } }),
  ]);
  const rows = [];
  for (const it of items) {
    const perStore = [];
    for (const st of stores) {
      const q = groups.find((g) => g.itemId === it.id && g.storeId === st.id)?._sum.quantity ?? 0;
      if (Math.abs(q) < 1e-9) continue;
      const p = await position(it.id, st.id);
      perStore.push({ store: st, quantity: p.quantity, unitCost: p.unitCost, value: Math.round(p.quantity * p.unitCost * 100) / 100 });
    }
    const total = perStore.reduce((a, s) => a + s.quantity, 0);
    rows.push({ item: it, stores: perStore, total, low: total <= it.reorderLevel });
  }
  return { stores, rows };
}

export async function issueStock(ctx: AuthContext, raw: unknown) {
  assertManage(ctx);
  const v = z.object({ itemId: z.string(), storeId: z.string(), quantity: z.number().positive(), departmentId: z.string(), note: z.string().trim().max(300).nullable().optional() }).parse(raw);
  const [item, dept] = await Promise.all([db.stockItem.findUnique({ where: { id: v.itemId } }), db.department.findUnique({ where: { id: v.departmentId } })]);
  if (!item || !dept) throw notFound("Item or department");
  const p = await position(v.itemId, v.storeId);
  if (p.quantity + 1e-9 < v.quantity) throw workflowError(`Only ${p.quantity} ${item.unit} in this store.`);
  const value = Math.round(v.quantity * p.unitCost * 100);
  try {
    await db.$transaction(async (tx) => {
      const m = await tx.stockMovement.create({ data: { itemId: v.itemId, storeId: v.storeId, kind: "ISSUE", quantity: -v.quantity, unitCost: p.unitCost, departmentId: v.departmentId, note: v.note ?? null, createdById: ctx.user.id } });
      if (value > 0) await postJournal(tx, { memo: `Stores issue: ${v.quantity} ${item.unit} ${item.name} to ${dept.code}`, sourceType: "stockIssue", sourceId: m.id, postedById: ctx.user.id }, [{ account: "CONSUMABLES_EXPENSE", debit: value, departmentId: v.departmentId }, { account: "INVENTORY", credit: value }]);
      await audit({ ...actor(ctx), action: "inventory.issue", resourceType: "stockItem", resourceId: v.itemId, summary: `${v.quantity} ${item.unit} to ${dept.code}` }, tx);
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("EXAMCORE: not enough stock")) throw workflowError("Not enough stock in the store.");
    throw e;
  }
}

export async function transferStock(ctx: AuthContext, raw: unknown) {
  assertManage(ctx);
  const v = z.object({ itemId: z.string(), fromStoreId: z.string(), toStoreId: z.string(), quantity: z.number().positive() }).parse(raw);
  if (v.fromStoreId === v.toStoreId) throw invalid("Choose two different stores.");
  const p = await position(v.itemId, v.fromStoreId);
  if (p.quantity + 1e-9 < v.quantity) throw workflowError(`Only ${p.quantity} in the source store.`);
  await db.$transaction(async (tx) => {
    await tx.stockMovement.create({ data: { itemId: v.itemId, storeId: v.fromStoreId, kind: "TRANSFER_OUT", quantity: -v.quantity, unitCost: p.unitCost, refType: "store", refId: v.toStoreId, createdById: ctx.user.id } });
    await tx.stockMovement.create({ data: { itemId: v.itemId, storeId: v.toStoreId, kind: "TRANSFER_IN", quantity: v.quantity, unitCost: p.unitCost, refType: "store", refId: v.fromStoreId, createdById: ctx.user.id } });
  });
}

/** Physical count: the difference from the books is posted as an adjustment (losses are expensed). */
export async function countStock(ctx: AuthContext, raw: unknown) {
  assertManage(ctx);
  const v = z.object({ itemId: z.string(), storeId: z.string(), counted: z.number().min(0), note: z.string().trim().min(5).max(300) }).parse(raw);
  const p = await position(v.itemId, v.storeId);
  const diff = Math.round((v.counted - p.quantity) * 1000) / 1000;
  if (diff === 0) return 0;
  const value = Math.round(Math.abs(diff) * p.unitCost * 100);
  await db.$transaction(async (tx) => {
    const m = await tx.stockMovement.create({ data: { itemId: v.itemId, storeId: v.storeId, kind: "ADJUSTMENT", quantity: diff, unitCost: p.unitCost, note: v.note, createdById: ctx.user.id } });
    if (value > 0) await postJournal(tx, { memo: `Stock count adjustment: ${v.note}`, sourceType: "stockAdjustment", sourceId: m.id, postedById: ctx.user.id }, diff < 0 ? [{ account: "CONSUMABLES_EXPENSE", debit: value }, { account: "INVENTORY", credit: value }] : [{ account: "INVENTORY", debit: value }, { account: "CONSUMABLES_EXPENSE", credit: value }]);
    await audit({ ...actor(ctx), action: "inventory.count", resourceType: "stockItem", resourceId: v.itemId, summary: `Adjusted by ${diff}: ${v.note}` }, tx);
  });
  return diff;
}
