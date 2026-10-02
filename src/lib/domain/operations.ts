/**
 * Operations rules (pure): Indian financial years, depreciation (straight-line and written-down value),
 * weighted-average stock cost, budget availability and facility clashes.
 */

const DAY = 86_400_000;

// ───────────────────────── Financial year (1 April – 31 March) ─────────────────────────

export function fiscalYearOf(d: Date): string {
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

export function fiscalYearRange(fy: string): { from: Date; to: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  if (!m) throw new Error(`Invalid financial year ${fy}`);
  const y = Number(m[1]);
  return { from: new Date(Date.UTC(y, 3, 1)), to: new Date(Date.UTC(y + 1, 3, 1)) };
}

// ───────────────────────── Depreciation ─────────────────────────

export interface DepreciableAsset {
  cost: number;
  salvageValue: number;
  usefulLifeYears: number;
  method: "STRAIGHT_LINE" | "WRITTEN_DOWN_VALUE";
  wdvRate: number | null;
  purchaseDate: Date;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Accumulated depreciation and book value at a date (pro rata by days). */
export function depreciation(a: DepreciableAsset, asOf: Date): { accumulated: number; bookValue: number } {
  const years = Math.max(0, (asOf.getTime() - a.purchaseDate.getTime()) / (365 * DAY));
  const floor = a.salvageValue;
  let book: number;
  if (a.method === "WRITTEN_DOWN_VALUE") {
    const rate = (a.wdvRate ?? 0) / 100;
    book = Math.max(floor, a.cost * Math.pow(1 - rate, years));
  } else {
    const perYear = (a.cost - a.salvageValue) / a.usefulLifeYears;
    book = Math.max(floor, a.cost - perYear * years);
  }
  return { accumulated: r2(a.cost - book), bookValue: r2(book) };
}

/** Depreciation charged within a financial year. */
export function depreciationForYear(a: DepreciableAsset, fy: string, disposedAt?: Date | null): number {
  const { from, to } = fiscalYearRange(fy);
  const start = a.purchaseDate > from ? a.purchaseDate : from;
  const end = disposedAt && disposedAt < to ? disposedAt : to;
  if (end <= start) return 0;
  return r2(depreciation(a, start).bookValue - depreciation(a, end).bookValue);
}

// ───────────────────────── Stock ─────────────────────────

/** Weighted-average unit cost of what is in store, from the movement ledger (oldest first). */
export function averageCost(movements: { quantity: number; unitCost: number }[]): { quantity: number; unitCost: number } {
  let qty = 0;
  let value = 0;
  for (const m of movements) {
    if (m.quantity > 0) {
      value += m.quantity * m.unitCost;
      qty += m.quantity;
    } else {
      const avg = qty > 0 ? value / qty : 0;
      qty += m.quantity;
      value = Math.max(0, value + m.quantity * avg);
    }
  }
  return { quantity: Math.round(qty * 1000) / 1000, unitCost: qty > 0 ? Math.round((value / qty) * 10_000) / 10_000 : 0 };
}

// ───────────────────────── Budgets ─────────────────────────

export function budgetPosition(amount: number, actual: number, committed: number) {
  const available = r2(amount - actual - committed);
  const usedPercent = amount > 0 ? Math.round(((actual + committed) / amount) * 1000) / 10 : 0;
  return { amount, actual: r2(actual), committed: r2(committed), available, usedPercent, over: available < 0 };
}

// ───────────────────────── Facility clashes ─────────────────────────

export interface Busy {
  startsAt: Date;
  endsAt: Date;
  label: string;
}

export function clashesWith(start: Date, end: Date, busy: Busy[]): Busy[] {
  return busy.filter((b) => b.startsAt < end && start < b.endsAt);
}
