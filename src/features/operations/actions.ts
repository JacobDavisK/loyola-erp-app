"use server";

import { revalidatePath } from "next/cache";
import { zonedTimeToUtc } from "@/lib/domain/timetable";
import { runAction } from "@/server/action";
import { requireAuth } from "@/server/auth/current";
import { disposeAsset, postDepreciation, recordAssetEvent, saveAsset, transferAsset } from "@/server/services/assets";
import { approveBudget, saveBudget, setBudgetLine } from "@/server/services/budgets";
import { recordVisit } from "@/server/services/clinic";
import { getInstitution } from "@/server/services/directory";
import { cancelBooking, decideBooking, requestBooking } from "@/server/services/facilities";
import { applyOutpass, cancelOutpass, checkInVisitor, checkOutVisitor, decideOutpass, gateMove, preRegisterVisitor } from "@/server/services/gate";
import { countStock, issueStock, saveItem, saveStore, transferStock } from "@/server/services/inventory";
import { approveVendorInvoice, createOrder, payVendorInvoice, receiveGoods, recordVendorInvoice, saveRequest, saveVendor, submitRequest } from "@/server/services/procurement";

const refresh = (...paths: string[]) => {
  for (const p of paths) revalidatePath(p, "layout");
};

/** datetime-local fields are in the institution's time zone. */
async function zoned(input: unknown, keys: string[]) {
  const { timezone } = await getInstitution();
  const out = { ...(input as Record<string, unknown>) };
  for (const k of keys) {
    const v = out[k];
    if (typeof v === "string" && v.length >= 16 && v[10] === "T") out[k] = zonedTimeToUtc(v.slice(0, 10), v.slice(11, 16), timezone);
    else if (v === "") out[k] = null;
  }
  return out;
}

// Procurement
export async function saveVendorAction(id: string | null, input: unknown) {
  return runAction(async () => { await saveVendor(await requireAuth(), id, input); refresh("/procurement"); }, "Vendor saved");
}
export async function saveRequestAction(id: string | null, input: unknown) {
  return runAction(async () => { const r = await saveRequest(await requireAuth(), id, input); refresh("/procurement"); return { id: r.id }; }, "Request saved");
}
export async function submitRequestAction(id: string) {
  return runAction(async () => { await submitRequest(await requireAuth(), id); refresh("/procurement", "/inbox"); }, "Sent for approval");
}
export async function createOrderAction(requestId: string, input: unknown) {
  return runAction(async () => { const po = await createOrder(await requireAuth(), requestId, input); refresh("/procurement"); return { id: po.id, number: po.number }; }, "Purchase order issued");
}
export async function receiveGoodsAction(poId: string, input: unknown) {
  return runAction(async () => { await receiveGoods(await requireAuth(), poId, input); refresh("/procurement", "/inventory", "/assets"); }, "Goods received");
}
export async function recordVendorInvoiceAction(poId: string | null, input: unknown) {
  return runAction(async () => { await recordVendorInvoice(await requireAuth(), poId!, input); refresh("/procurement"); }, "Bill recorded");
}
export async function approveVendorInvoiceAction(id: string) {
  return runAction(async () => { await approveVendorInvoice(await requireAuth(), id); refresh("/procurement", "/budgets"); }, "Bill approved and posted");
}
export async function payVendorInvoiceAction(id: string, ref: string) {
  return runAction(async () => { await payVendorInvoice(await requireAuth(), id, ref); refresh("/procurement"); }, "Payment recorded");
}

// Budgets
export async function saveBudgetAction(_id: string | null, input: unknown) {
  return runAction(async () => { const b = await saveBudget(await requireAuth(), input); refresh("/budgets"); return { id: b.id }; }, "Budget created");
}
export async function setBudgetLineAction(budgetId: string | null, input: unknown) {
  return runAction(async () => { await setBudgetLine(await requireAuth(), budgetId!, input); refresh("/budgets"); }, "Line saved");
}
export async function approveBudgetAction(id: string) {
  return runAction(async () => { await approveBudget(await requireAuth(), id); refresh("/budgets"); }, "Budget approved");
}

// Inventory
export async function saveStoreAction(id: string | null, input: unknown) {
  return runAction(async () => { await saveStore(await requireAuth(), id, input); refresh("/inventory"); }, "Store saved");
}
export async function saveItemAction(id: string | null, input: unknown) {
  return runAction(async () => { await saveItem(await requireAuth(), id, input); refresh("/inventory"); }, "Item saved");
}
export async function issueStockAction(_id: string | null, input: unknown) {
  return runAction(async () => { await issueStock(await requireAuth(), input); refresh("/inventory", "/budgets"); }, "Issued");
}
export async function transferStockAction(_id: string | null, input: unknown) {
  return runAction(async () => { await transferStock(await requireAuth(), input); refresh("/inventory"); }, "Transferred");
}
export async function countStockAction(_id: string | null, input: unknown) {
  return runAction(async () => { const d = await countStock(await requireAuth(), input); refresh("/inventory"); return d; }, "Count recorded");
}

// Assets
export async function saveAssetAction(id: string | null, input: unknown) {
  return runAction(async () => { const a = await saveAsset(await requireAuth(), id, input); refresh("/assets"); return { id: a.id }; }, "Asset saved");
}
export async function transferAssetAction(id: string | null, input: unknown) {
  return runAction(async () => { await transferAsset(await requireAuth(), id!, input); refresh("/assets"); }, "Asset moved");
}
export async function assetEventAction(id: string | null, input: unknown) {
  return runAction(async () => { await recordAssetEvent(await requireAuth(), id!, input); refresh("/assets"); }, "Recorded");
}
export async function disposeAssetAction(id: string | null, input: unknown) {
  return runAction(async () => { await disposeAsset(await requireAuth(), id!, input); refresh("/assets"); }, "Asset disposed of");
}
export async function postDepreciationAction(fy: string) {
  return runAction(async () => { await postDepreciation(await requireAuth(), fy); refresh("/assets", "/finance/ledger"); }, "Depreciation posted");
}

// Facilities
export async function requestBookingAction(_id: string | null, input: unknown) {
  return runAction(async () => { const b = await requestBooking(await requireAuth(), await zoned(input, ["startsAt", "endsAt"])); refresh("/facilities"); return { status: b.status }; }, "Booking made");
}
export async function decideBookingAction(id: string, approve: boolean, note?: string) {
  return runAction(async () => { await decideBooking(await requireAuth(), id, approve, note); refresh("/facilities"); }, approve ? "Booking confirmed" : "Booking refused");
}
export async function cancelBookingAction(id: string) {
  return runAction(async () => { await cancelBooking(await requireAuth(), id); refresh("/facilities"); }, "Booking cancelled");
}

// Gate
export async function preRegisterVisitorAction(_id: string | null, input: unknown) {
  return runAction(async () => { const v = await preRegisterVisitor(await requireAuth(), await zoned(input, ["expectedAt"])); refresh("/visitors"); return { passCode: v.passCode }; }, "Visitor expected — share the pass code");
}
export async function checkInVisitorAction(_id: string | null, input: unknown) {
  return runAction(async () => { await checkInVisitor(await requireAuth(), input); refresh("/gate"); }, "Visitor checked in");
}
export async function checkOutVisitorAction(id: string) {
  return runAction(async () => { await checkOutVisitor(await requireAuth(), id); refresh("/gate"); }, "Visitor checked out");
}
export async function applyOutpassAction(_id: string | null, input: unknown) {
  return runAction(async () => { await applyOutpass(await requireAuth(), await zoned(input, ["leaveAt", "returnBy"])); refresh("/portal/outpass"); }, "Out-pass requested");
}
export async function cancelOutpassAction(id: string) {
  return runAction(async () => { await cancelOutpass(await requireAuth(), id); refresh("/portal/outpass"); }, "Out-pass cancelled");
}
export async function decideOutpassAction(id: string, approve: boolean, note?: string) {
  return runAction(async () => { await decideOutpass(await requireAuth(), id, approve, note); refresh("/gate"); }, approve ? "Out-pass approved" : "Out-pass refused");
}
export async function gateMoveAction(id: string) {
  return runAction(async () => { const r = await gateMove(await requireAuth(), id); refresh("/gate"); return r; }, "Recorded at the gate");
}

// Health centre
export async function recordVisitAction(_id: string | null, input: unknown) {
  return runAction(async () => { const v = await recordVisit(await requireAuth(), input); refresh("/health"); return { id: v.id }; }, "Visit recorded");
}
