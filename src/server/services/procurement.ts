import "server-only";
import { z } from "zod";
import type { Prisma, PurchaseKind } from "@/generated/prisma/client";
import { fromMinor, toMinor } from "@/lib/domain/money";
import { type AuthContext, can, isSuperAdmin, scopeOf } from "@/server/auth/current";
import { db, type Tx } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { budgetLineAvailable } from "@/server/services/budgets";
import { postJournal } from "@/server/services/ledger";
import { nextNumber } from "@/server/services/sequence";
import { getSetting } from "@/server/services/settings";
import { resubmitWorkflow, startWorkflow } from "@/server/services/workflow";

/**
 * Purchasing: a department raises a purchase request (approved by the HoD, and by the Finance Officer for
 * large amounts, checked against the budget line); the purchase officer turns it into a purchase order to
 * a vendor; goods are received into a store (stock) or the asset register (equipment); the vendor's bill is
 * approved — posting it to the ledger against the department — and then paid.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });
const minor = (d: Prisma.Decimal | number) => toMinor(d);

// ───────────────────────── Vendors ─────────────────────────

export async function saveVendor(ctx: AuthContext, id: string | null, raw: unknown) {
  if (!can(ctx, "procurement.manage")) throw forbidden();
  const v = z.object({
    name: z.string().trim().min(2).max(200),
    gstin: z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z0-9]{13}$/, "A GSTIN has 15 characters").nullable().optional().or(z.literal("").transform(() => null)),
    contactName: z.string().trim().max(120).nullable().optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    email: z.string().trim().email().nullable().optional().or(z.literal("").transform(() => null)),
    address: z.string().trim().max(500).nullable().optional(),
    categories: z.string().trim().max(300).nullable().optional(),
    active: z.boolean().default(true),
  }).parse(raw);
  const data = { ...v, categories: (v.categories ?? "").split(",").map((c) => c.trim()).filter(Boolean) };
  const vendor = id ? await db.vendor.update({ where: { id }, data }) : await db.vendor.create({ data });
  await audit({ ...actor(ctx), action: "procurement.vendor", resourceType: "vendor", resourceId: vendor.id, summary: v.name });
  return vendor;
}

// ───────────────────────── Purchase requests ─────────────────────────

const lineSchema = z.object({
  kind: z.enum(["STOCK", "ASSET", "SERVICE"]),
  description: z.string().trim().min(2).max(300),
  itemId: z.string().nullable().optional(),
  quantity: z.number().positive().max(1_000_000),
  unit: z.string().trim().min(1).max(20),
  estUnitPrice: z.number().min(0).max(1e10),
});

const requestSchema = z.object({
  departmentId: z.string(),
  title: z.string().trim().min(3).max(200),
  justification: z.string().trim().min(10).max(4000),
  budgetLineId: z.string().nullable().optional(),
  lines: z.array(lineSchema).min(1).max(100),
});

function assertDept(ctx: AuthContext, departmentId: string) {
  if (!can(ctx, "procurement.request", departmentId) && !can(ctx, "procurement.manage") && !isSuperAdmin(ctx)) throw forbidden();
}

export async function saveRequest(ctx: AuthContext, id: string | null, raw: unknown) {
  const v = requestSchema.parse(raw);
  assertDept(ctx, v.departmentId);
  for (const l of v.lines) if (l.kind === "STOCK" && !l.itemId) throw invalid(`Choose the store item for "${l.description}".`);
  const total = v.lines.reduce((a, l) => a + Math.round(l.quantity * l.estUnitPrice * 100), 0);
  if (id) {
    const cur = await db.purchaseRequest.findUnique({ where: { id } });
    if (!cur) throw notFound("Purchase request");
    if (cur.status !== "DRAFT") throw workflowError("Only draft requests can be edited.");
  }
  return db.$transaction(async (tx) => {
    const data = { departmentId: v.departmentId, title: v.title, justification: v.justification, budgetLineId: v.budgetLineId || null, total: fromMinor(total) };
    const r = id
      ? await tx.purchaseRequest.update({ where: { id }, data })
      : await tx.purchaseRequest.create({ data: { ...data, number: await nextNumber(tx, "procurement.pr", { prefix: "PR/{YYYY}/", padding: 5 }), requestedById: ctx.user.id } });
    await tx.purchaseRequestLine.deleteMany({ where: { requestId: r.id } });
    await tx.purchaseRequestLine.createMany({ data: v.lines.map((l) => ({ ...l, itemId: l.itemId || null, requestId: r.id, estUnitPrice: fromMinor(Math.round(l.estUnitPrice * 100)) })) });
    return r;
  });
}

export async function submitRequest(ctx: AuthContext, id: string) {
  const r = await db.purchaseRequest.findUnique({ where: { id }, include: { department: true, budgetLine: { include: { account: true, budget: true } } } });
  if (!r) throw notFound("Purchase request");
  if (r.requestedById !== ctx.user.id && !isSuperAdmin(ctx)) throw forbidden();
  if (r.status !== "DRAFT") throw workflowError("The request has already been submitted.");
  let available: number | null = null;
  if (r.budgetLine) {
    if (r.budgetLine.budget.status !== "APPROVED") throw workflowError("The chosen budget is not approved yet.");
    available = (await budgetLineAvailable(r.budgetLine.id)) / 100;
    if (minor(r.total) > Math.round(available * 100)) throw workflowError(`The budget line has only ${available.toFixed(2)} available.`);
  }
  const data = { requestId: r.id, number: r.number, title: r.title, department: r.department.name, amount: Number(r.total), budget: r.budgetLine ? `${r.budgetLine.budget.fiscalYear} · ${r.budgetLine.account.name}` : null, available, requestedById: r.requestedById };
  await db.$transaction(async (tx) => {
    await tx.purchaseRequest.update({ where: { id }, data: { status: "SUBMITTED" } });
    if (r.workflowId) await resubmitWorkflow(tx, { id: ctx.user.id, name: ctx.user.name }, r.workflowId, data);
    else {
      const wf = await startWorkflow(tx, { id: ctx.user.id, name: ctx.user.name }, { key: "procurement.request", resourceType: "purchaseRequest", resourceId: r.id, title: `${r.number}: ${r.title}`, summary: r.justification, departmentId: r.departmentId, subjectUserId: r.requestedById, data });
      await tx.purchaseRequest.update({ where: { id }, data: { workflowId: wf.id } });
    }
    await audit({ ...actor(ctx), action: "procurement.request.submit", resourceType: "purchaseRequest", resourceId: id, summary: `${r.number} (${Number(r.total).toFixed(2)})` }, tx);
  });
}

export function requestWhere(ctx: AuthContext): Prisma.PurchaseRequestWhereInput {
  if (isSuperAdmin(ctx) || can(ctx, "procurement.manage") || can(ctx, "procurement.pay")) return {};
  const scope = scopeOf(ctx, "procurement.request");
  return { OR: [{ requestedById: ctx.user.id }, ...(scope === null ? [{}] : scope.length ? [{ departmentId: { in: scope } }] : [])] };
}

// ───────────────────────── Purchase orders and receipts ─────────────────────────

export async function createOrder(ctx: AuthContext, requestId: string, raw: unknown) {
  if (!can(ctx, "procurement.manage")) throw forbidden();
  const v = z.object({ vendorId: z.string(), expectedOn: z.coerce.date().nullable().optional(), taxPercent: z.number().min(0).max(40).default(0), terms: z.string().trim().max(2000).nullable().optional(), prices: z.record(z.string(), z.number().min(0)).optional() }).parse(raw);
  const r = await db.purchaseRequest.findUnique({ where: { id: requestId }, include: { lines: true } });
  if (!r) throw notFound("Purchase request");
  if (r.status !== "APPROVED") throw workflowError("Only approved requests can be ordered.");
  const vendor = await db.vendor.findFirst({ where: { id: v.vendorId, active: true } });
  if (!vendor) throw invalid("Choose an active vendor.");
  const lines = r.lines.map((l) => ({ kind: l.kind, description: l.description, itemId: l.itemId, quantity: l.quantity, unit: l.unit, unitPriceMinor: Math.round((v.prices?.[l.id] ?? Number(l.estUnitPrice)) * 100) }));
  const sub = lines.reduce((a, l) => a + Math.round(l.quantity * l.unitPriceMinor), 0);
  const total = sub + Math.round(sub * (v.taxPercent / 100));
  return db.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.create({
      data: {
        number: await nextNumber(tx, "procurement.po", { prefix: "PO/{YYYY}/", padding: 5 }), requestId, vendorId: vendor.id, departmentId: r.departmentId, expectedOn: v.expectedOn ?? null, taxPercent: v.taxPercent, terms: v.terms ?? null, total: fromMinor(total), createdById: ctx.user.id,
        lines: { create: lines.map((l) => ({ kind: l.kind, description: l.description, itemId: l.itemId, quantity: l.quantity, unit: l.unit, unitPrice: fromMinor(l.unitPriceMinor) })) },
      },
    });
    await tx.purchaseRequest.update({ where: { id: requestId }, data: { status: "ORDERED" } });
    await audit({ ...actor(ctx), action: "procurement.po.create", resourceType: "purchaseOrder", resourceId: po.id, summary: `${po.number} to ${vendor.name}: ${(total / 100).toFixed(2)}` }, tx);
    return po;
  });
}

/** Receive goods against an order. Stock lines go into a store; asset lines become register entries. */
export async function receiveGoods(ctx: AuthContext, poId: string, raw: unknown) {
  if (!can(ctx, "procurement.manage") && !can(ctx, "inventory.manage")) throw forbidden();
  const v = z.object({ storeId: z.string().nullable().optional(), quantities: z.record(z.string(), z.number().min(0)), notes: z.string().trim().max(1000).nullable().optional(), assetCategory: z.string().trim().max(60).default("Equipment"), usefulLifeYears: z.number().positive().max(60).default(5) }).parse(raw);
  const po = await db.purchaseOrder.findUnique({ where: { id: poId }, include: { lines: true } });
  if (!po) throw notFound("Purchase order");
  if (!["ISSUED", "PART_RECEIVED"].includes(po.status)) throw workflowError("This order is not open for receipt.");
  const got = po.lines.map((l) => ({ line: l, qty: v.quantities[l.id] ?? 0 })).filter((x) => x.qty > 0);
  if (!got.length) throw invalid("Enter the quantities received.");
  for (const g of got) if (g.line.receivedQty + g.qty > g.line.quantity + 1e-9) throw invalid(`More received than ordered for "${g.line.description}".`);
  if (got.some((g) => g.line.kind === "STOCK") && !v.storeId) throw invalid("Choose the store receiving the stock.");
  const ops = await getSetting("operations");
  return db.$transaction(async (tx) => {
    const grn = await tx.goodsReceipt.create({ data: { number: await nextNumber(tx, "procurement.grn", { prefix: "GRN/{YYYY}/", padding: 5 }), poId, storeId: v.storeId ?? null, receivedById: ctx.user.id, notes: v.notes ?? null } });
    for (const g of got) {
      await tx.goodsReceiptLine.create({ data: { receiptId: grn.id, poLineId: g.line.id, quantity: g.qty } });
      await tx.purchaseOrderLine.update({ where: { id: g.line.id }, data: { receivedQty: { increment: g.qty } } });
      const unitCost = Number(g.line.unitPrice) * (1 + po.taxPercent / 100);
      if (g.line.kind === "STOCK" && g.line.itemId) {
        await tx.stockMovement.create({ data: { itemId: g.line.itemId, storeId: v.storeId!, kind: "RECEIPT", quantity: g.qty, unitCost, refType: "goodsReceipt", refId: grn.id, createdById: ctx.user.id } });
      }
      if (g.line.kind === "ASSET") {
        for (let i = 0; i < Math.floor(g.qty); i++) {
          const tag = await nextNumber(tx, "asset.tag", { prefix: ops.assetTagPrefix, padding: 5 });
          const a = await tx.asset.create({ data: { tag, name: g.line.description, category: v.assetCategory, departmentId: po.departmentId, purchaseDate: new Date(), cost: fromMinor(Math.round(unitCost * 100)), usefulLifeYears: v.usefulLifeYears, poLineId: g.line.id } });
          await tx.assetEvent.create({ data: { assetId: a.id, kind: "ACQUIRED", note: `Received on ${grn.number} (${po.number})`, actorId: ctx.user.id } });
        }
      }
    }
    const lines = await tx.purchaseOrderLine.findMany({ where: { poId } });
    const complete = lines.every((l) => l.receivedQty >= l.quantity - 1e-9);
    await tx.purchaseOrder.update({ where: { id: poId }, data: { status: complete ? "RECEIVED" : "PART_RECEIVED" } });
    await audit({ ...actor(ctx), action: "procurement.grn", resourceType: "purchaseOrder", resourceId: poId, summary: `${grn.number}: ${got.length} line(s)${complete ? ", order complete" : ""}` }, tx);
    return grn;
  });
}

// ───────────────────────── Vendor bills ─────────────────────────

export async function recordVendorInvoice(ctx: AuthContext, poId: string, raw: unknown) {
  if (!can(ctx, "procurement.manage") && !can(ctx, "procurement.pay")) throw forbidden();
  const v = z.object({ invoiceNo: z.string().trim().min(1).max(60), invoiceDate: z.coerce.date(), amount: z.number().positive() }).parse(raw);
  const po = await db.purchaseOrder.findUnique({ where: { id: poId }, include: { invoices: { where: { status: { not: "REJECTED" } } } } });
  if (!po) throw notFound("Purchase order");
  const billed = po.invoices.reduce((a, i) => a + minor(i.amount), 0);
  if (billed + Math.round(v.amount * 100) > minor(po.total) + 100) throw workflowError("Bills would exceed the order value.");
  if (await db.vendorInvoice.findFirst({ where: { vendorId: po.vendorId, invoiceNo: v.invoiceNo } })) throw conflict("This vendor bill number is already recorded.");
  return db.vendorInvoice.create({ data: { poId, vendorId: po.vendorId, invoiceNo: v.invoiceNo, invoiceDate: v.invoiceDate, amount: fromMinor(Math.round(v.amount * 100)) } });
}

/** The account a purchase of each kind is charged to. */
const DEBIT: Record<PurchaseKind, "INVENTORY" | "FIXED_ASSETS" | "PURCHASES_EXPENSE"> = { STOCK: "INVENTORY", ASSET: "FIXED_ASSETS", SERVICE: "PURCHASES_EXPENSE" };

async function postBill(tx: Tx, bill: { id: string; amount: Prisma.Decimal; invoiceNo: string }, po: { id: string; number: string; departmentId: string; lines: { kind: PurchaseKind; quantity: number; unitPrice: Prisma.Decimal }[] }, actorId: string) {
  // Split the bill across the order's kinds in proportion to their value.
  const byKind = new Map<PurchaseKind, number>();
  for (const l of po.lines) byKind.set(l.kind, (byKind.get(l.kind) ?? 0) + l.quantity * Number(l.unitPrice));
  const totalValue = [...byKind.values()].reduce((a, b) => a + b, 0) || 1;
  const amount = minor(bill.amount);
  const kinds = [...byKind.keys()];
  let allocated = 0;
  const debits = kinds.map((k, i) => {
    const part = i === kinds.length - 1 ? amount - allocated : Math.round((amount * byKind.get(k)!) / totalValue);
    allocated += part;
    return { account: DEBIT[k], debit: part, departmentId: po.departmentId };
  });
  await postJournal(tx, { memo: `Vendor bill ${bill.invoiceNo} on ${po.number}`, sourceType: "vendorInvoice", sourceId: bill.id, postedById: actorId }, [...debits, { account: "ACCOUNTS_PAYABLE", credit: amount }]);
}

export async function approveVendorInvoice(ctx: AuthContext, id: string) {
  if (!can(ctx, "procurement.pay")) throw forbidden();
  const bill = await db.vendorInvoice.findUnique({ where: { id }, include: { po: { include: { lines: true } } } });
  if (!bill) throw notFound("Vendor bill");
  if (bill.status !== "RECEIVED") throw workflowError("This bill has already been decided.");
  if (bill.po.status === "ISSUED") throw workflowError("Nothing has been received on this order yet.");
  await db.$transaction(async (tx) => {
    await tx.vendorInvoice.update({ where: { id }, data: { status: "APPROVED", approvedById: ctx.user.id, approvedAt: new Date() } });
    await postBill(tx, bill, bill.po, ctx.user.id);
    await audit({ ...actor(ctx), action: "procurement.bill.approve", resourceType: "vendorInvoice", resourceId: id, summary: `${bill.invoiceNo}: ${Number(bill.amount).toFixed(2)}` }, tx);
  });
}

export async function payVendorInvoice(ctx: AuthContext, id: string, paymentRef: string) {
  if (!can(ctx, "procurement.pay")) throw forbidden();
  const bill = await db.vendorInvoice.findUnique({ where: { id } });
  if (!bill) throw notFound("Vendor bill");
  if (bill.status !== "APPROVED") throw workflowError("Approve the bill before paying it.");
  if (paymentRef.trim().length < 3) throw invalid("Enter the payment reference (NEFT / cheque number).");
  await db.$transaction(async (tx) => {
    await tx.vendorInvoice.update({ where: { id }, data: { status: "PAID", paidAt: new Date(), paymentRef: paymentRef.trim() } });
    await postJournal(tx, { memo: `Payment of vendor bill ${bill.invoiceNo} (${paymentRef.trim()})`, sourceType: "vendorPayment", sourceId: id, postedById: ctx.user.id }, [{ account: "ACCOUNTS_PAYABLE", debit: minor(bill.amount) }, { account: "BANK", credit: minor(bill.amount) }]);
    await audit({ ...actor(ctx), action: "procurement.bill.pay", resourceType: "vendorInvoice", resourceId: id, summary: `${bill.invoiceNo}: ${paymentRef}` }, tx);
  });
}
