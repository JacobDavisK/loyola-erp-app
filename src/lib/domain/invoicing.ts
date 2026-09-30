/**
 * Invoicing rules (pure, minor units).
 */
import type { Minor } from "@/lib/domain/money";

export interface StructureLine {
  feeHeadId: string;
  feeHeadName: string;
  amount: Minor;
  semester: number | null;
  termType: "ODD" | "EVEN" | null;
  dueDays: number;
}

/**
 * Lines of a fee structure that apply to a student's semester in a term.
 * A line with a semester applies only to that semester; a line with a term type applies to every
 * semester of that type; a line with neither applies once per term.
 */
export function applicableLines(lines: StructureLine[], semester: number, termType: "ODD" | "EVEN"): StructureLine[] {
  return lines.filter((l) => (l.semester === null || l.semester === semester) && (l.termType === null || l.termType === termType) && l.amount > 0);
}

export type InvoiceState = "DRAFT" | "ISSUED" | "PARTIALLY_PAID" | "PAID" | "CANCELLED";

export function invoiceStatus(total: Minor, paid: Minor, cancelled: boolean): InvoiceState {
  if (cancelled) return "CANCELLED";
  if (paid <= 0) return total === 0 ? "PAID" : "ISSUED";
  return paid >= total ? "PAID" : "PARTIALLY_PAID";
}

export interface OpenInvoice {
  id: string;
  dueDate: Date;
  balance: Minor;
}

/**
 * Split a payment across open invoices: the named invoice first, then oldest due date first.
 * Returns the allocations and any amount left over (an advance, held on the student's account).
 */
export function allocate(amount: Minor, invoices: OpenInvoice[], preferInvoiceId?: string): { allocations: { invoiceId: string; amount: Minor }[]; unallocated: Minor } {
  const order = [...invoices].filter((i) => i.balance > 0).sort((a, b) => {
    if (a.id === preferInvoiceId) return -1;
    if (b.id === preferInvoiceId) return 1;
    return a.dueDate.getTime() - b.dueDate.getTime();
  });
  let left = amount;
  const allocations: { invoiceId: string; amount: Minor }[] = [];
  for (const inv of order) {
    if (left <= 0) break;
    const take = Math.min(left, inv.balance);
    allocations.push({ invoiceId: inv.id, amount: take });
    left -= take;
  }
  return { allocations, unallocated: left };
}

/**
 * Spread a concession over invoice lines proportionally (largest remainder), so each line's
 * concession never exceeds the line amount and the parts add up exactly.
 */
export function spreadConcession(lines: { id: string; amount: Minor; concession: Minor }[], concession: Minor): { id: string; concession: Minor }[] {
  const room = lines.map((l) => ({ id: l.id, room: l.amount - l.concession }));
  const totalRoom = room.reduce((a, r) => a + r.room, 0);
  if (concession > totalRoom) throw new Error("The concession is larger than the amount still due on the invoice.");
  if (totalRoom === 0) return [];
  const raw = room.map((r) => ({ id: r.id, exact: (concession * r.room) / totalRoom, room: r.room }));
  const base = raw.map((r) => ({ id: r.id, add: Math.floor(r.exact), frac: r.exact - Math.floor(r.exact), room: r.room }));
  let remainder = concession - base.reduce((a, b) => a + b.add, 0);
  for (const b of [...base].sort((x, y) => y.frac - x.frac)) {
    if (remainder <= 0) break;
    if (b.add < b.room) {
      b.add++;
      remainder--;
    }
  }
  return base.filter((b) => b.add > 0).map((b) => ({ id: b.id, concession: b.add }));
}
