/**
 * Human-resources rules (pure): leave day counting, leave balances, payroll computation and the
 * configurable income-tax projection. Money is in integer minor units (see money.ts).
 *
 * The tax projection is a configurable estimate for monthly withholding. It is not tax advice: the slabs,
 * standard deduction, rebate and cess come from HR settings and must be maintained by the institution.
 */
import { percentOf, sum, type Minor } from "./money";

// ───────────────────────── Dates ─────────────────────────

const DAY = 86_400_000;

/** "YYYY-MM-DD" of a UTC-midnight date. */
export const ymd = (d: Date) => d.toISOString().slice(0, 10);
export const dateOnly = (s: string) => new Date(`${s}T00:00:00Z`);

/** Every date from `from` to `to` inclusive (UTC dates). */
export function eachDay(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += DAY) out.push(new Date(t));
  return out;
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export const isoDay = (d: Date) => ((d.getUTCDay() + 6) % 7) + 1;

export interface WorkCalendar {
  /** ISO weekdays that are working days, e.g. [1,2,3,4,5,6] */
  workWeek: number[];
  /** Holidays as YYYY-MM-DD */
  holidays: Set<string>;
}

export const isWorkingDay = (d: Date, cal: WorkCalendar) => cal.workWeek.includes(isoDay(d)) && !cal.holidays.has(ymd(d));

/** Working days of a leave request. Weekends and holidays inside the range are not charged; a half day is 0.5. */
export function leaveDays(from: Date, to: Date, halfDay: boolean, cal: WorkCalendar): number {
  if (to < from) return 0;
  if (halfDay) return from.getTime() === to.getTime() && isWorkingDay(from, cal) ? 0.5 : 0;
  return eachDay(from, to).filter((d) => isWorkingDay(d, cal)).length;
}

/** Overlap of two inclusive date ranges, or null. */
export function overlap(aFrom: Date, aTo: Date, bFrom: Date, bTo: Date): { from: Date; to: Date } | null {
  const from = aFrom > bFrom ? aFrom : bFrom;
  const to = aTo < bTo ? aTo : bTo;
  return from <= to ? { from, to } : null;
}

/** First and last day of a payroll period "YYYY-MM". */
export function periodRange(period: string): { from: Date; to: Date; days: number } {
  const [y, m] = period.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0));
  return { from, to, days: to.getUTCDate() };
}

// ───────────────────────── Leave balances ─────────────────────────

export interface Balance { entitled: number; carriedForward: number; used: number }

export const available = (b: Balance) => round2(b.entitled + b.carriedForward - b.used);

/** Opening balance for a new year: carry forward what is left, up to the leave type's cap. */
export function carryForward(prev: Balance | null, cap: number): number {
  if (!prev || cap <= 0) return 0;
  return Math.max(0, Math.min(cap, available(prev)));
}

/** Pro-rated entitlement for someone joining during the year (whole half-days, rounded down). */
export function proratedQuota(annualQuota: number, joinDate: Date, year: number): number {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year, 11, 31));
  if (joinDate <= start) return annualQuota;
  if (joinDate > end) return 0;
  const remaining = (end.getTime() - joinDate.getTime()) / DAY + 1;
  const daysInYear = (end.getTime() - start.getTime()) / DAY + 1;
  return Math.floor(((annualQuota * remaining) / daysInYear) * 2) / 2;
}

export interface LeaveCheck { ok: boolean; reason?: string }

/** Validate a leave application against policy and balance. */
export function checkLeave(input: {
  days: number;
  halfDay: boolean;
  allowHalfDay: boolean;
  maxConsecutive: number | null;
  paid: boolean;
  balance: Balance | null;
  overlapsExisting: boolean;
}): LeaveCheck {
  if (input.days <= 0) return { ok: false, reason: "The selected dates contain no working days." };
  if (input.halfDay && !input.allowHalfDay) return { ok: false, reason: "This leave type cannot be taken as a half day." };
  if (input.maxConsecutive && input.days > input.maxConsecutive) return { ok: false, reason: `At most ${input.maxConsecutive} days of this leave can be taken at a time.` };
  if (input.overlapsExisting) return { ok: false, reason: "You already have leave applied for some of these dates." };
  if (input.paid) {
    if (!input.balance) return { ok: false, reason: "No leave balance has been set up for this leave type this year. Contact HR." };
    if (input.days > available(input.balance)) return { ok: false, reason: `Only ${available(input.balance)} day(s) available.` };
  }
  return { ok: true };
}

// ───────────────────────── Tax ─────────────────────────

export interface TaxSlab { upTo: number | null; rate: number } // upTo in currency units (null = no upper limit)
export interface TaxRegime {
  standardDeduction: number;
  slabs: TaxSlab[];
  /** Full rebate of tax when taxable income ≤ rebateLimit (capped at rebateMax); 0 disables it. */
  rebateLimit: number;
  rebateMax: number;
  cessPercent: number;
}

/** Annual tax (minor units) on annual taxable income (minor units) under a slab regime. */
export function annualTax(incomeMinor: Minor, regime: TaxRegime): Minor {
  const taxable = Math.max(0, incomeMinor - regime.standardDeduction * 100);
  let tax = 0;
  let lower = 0;
  for (const s of regime.slabs) {
    const upper = s.upTo === null ? Infinity : s.upTo * 100;
    if (taxable > lower) tax += ((Math.min(taxable, upper) - lower) * s.rate) / 100;
    lower = upper;
    if (taxable <= upper) break;
  }
  tax = Math.round(tax);
  if (regime.rebateLimit > 0 && taxable <= regime.rebateLimit * 100) tax = Math.max(0, tax - regime.rebateMax * 100);
  return tax + percentOf(tax, regime.cessPercent);
}

// ───────────────────────── Payroll ─────────────────────────

export type ComponentKind = "EARNING" | "DEDUCTION" | "EMPLOYER_CONTRIBUTION";
export type ComponentCalc = "FIXED" | "PERCENT_OF_BASIC" | "PERCENT_OF_GROSS" | "INCOME_TAX";

export interface PayComponent {
  code: string;
  name: string;
  kind: ComponentKind;
  calc: ComponentCalc;
  /** Minor units for FIXED, a percentage for PERCENT_* */
  value: number;
  /** Monthly cap in minor units */
  cap: Minor | null;
  taxable: boolean;
  order: number;
}

export interface PayslipLine { code: string; name: string; kind: ComponentKind | "BASIC"; calc?: ComponentCalc; amount: Minor }

export interface PayslipResult {
  basic: Minor;
  gross: Minor;
  deductions: Minor;
  employerContributions: Minor;
  net: Minor;
  payableDays: number;
  lines: PayslipLine[];
}

/**
 * One month's pay.
 *  - Basic and earnings are pro-rated by payable days / working days (loss of pay and partial months).
 *  - Percentages of basic use the pro-rated basic; percentages of gross use the gross of basic + earnings
 *    that are not themselves percent-of-gross.
 *  - Fixed deductions are not pro-rated (e.g. professional tax), but a deduction never exceeds what is left.
 *  - INCOME_TAX projects the month's taxable gross over twelve months and withholds a twelfth of the annual tax.
 */
export function computePayslip(input: {
  basicMonthly: Minor;
  components: PayComponent[];
  workingDays: number;
  payableDays: number;
  tax: TaxRegime | null;
}): PayslipResult {
  const payable = Math.max(0, Math.min(input.workingDays, input.payableDays));
  const factor = input.workingDays > 0 ? payable / input.workingDays : 0;
  const basic = Math.round(input.basicMonthly * factor);
  const comps = [...input.components].sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));
  const capped = (c: PayComponent, m: Minor) => (c.cap !== null ? Math.min(m, c.cap) : m);

  const lines: PayslipLine[] = [{ code: "BASIC", name: "Basic pay", kind: "BASIC", amount: basic }];
  const taxableFlags: boolean[] = [true];

  const earnings = comps.filter((c) => c.kind === "EARNING");
  for (const c of earnings.filter((c) => c.calc !== "PERCENT_OF_GROSS")) {
    const amt = c.calc === "FIXED" ? Math.round(c.value * factor) : c.calc === "PERCENT_OF_BASIC" ? percentOf(basic, c.value) : 0;
    lines.push({ code: c.code, name: c.name, kind: "EARNING", amount: capped(c, amt) });
    taxableFlags.push(c.taxable);
  }
  const preGross = sum(lines.map((l) => l.amount));
  for (const c of earnings.filter((c) => c.calc === "PERCENT_OF_GROSS")) {
    lines.push({ code: c.code, name: c.name, kind: "EARNING", amount: capped(c, percentOf(preGross, c.value)) });
    taxableFlags.push(c.taxable);
  }
  const gross = sum(lines.map((l) => l.amount));
  const taxableGross = sum(lines.map((l, i) => (taxableFlags[i] ? l.amount : 0)));

  const amountFor = (c: PayComponent): Minor => {
    switch (c.calc) {
      case "FIXED": return c.value;
      case "PERCENT_OF_BASIC": return percentOf(basic, c.value);
      case "PERCENT_OF_GROSS": return percentOf(gross, c.value);
      case "INCOME_TAX": return input.tax && gross > 0 ? Math.round(annualTax(taxableGross * 12, input.tax) / 12) : 0;
    }
  };

  let deductions = 0;
  for (const c of comps.filter((c) => c.kind === "DEDUCTION")) {
    const amt = Math.min(capped(c, amountFor(c)), Math.max(0, gross - deductions));
    lines.push({ code: c.code, name: c.name, kind: "DEDUCTION", calc: c.calc, amount: amt });
    deductions += amt;
  }
  let employer = 0;
  for (const c of comps.filter((c) => c.kind === "EMPLOYER_CONTRIBUTION")) {
    const amt = capped(c, amountFor(c));
    lines.push({ code: c.code, name: c.name, kind: "EMPLOYER_CONTRIBUTION", amount: amt });
    employer += amt;
  }
  return { basic, gross, deductions, employerContributions: employer, net: gross - deductions, payableDays: payable, lines };
}

/**
 * Payable days in a period: days employed in the month (scaled to the run's working days) less loss of pay.
 * `lopDays` are unpaid leave and unauthorised absence.
 */
export function payableDays(input: { workingDays: number; periodFrom: Date; periodTo: Date; joinDate: Date; exitDate: Date | null; lopDays: number }): number {
  const employed = overlap(input.periodFrom, input.periodTo, input.joinDate, input.exitDate ?? input.periodTo);
  if (!employed) return 0;
  const monthDays = (input.periodTo.getTime() - input.periodFrom.getTime()) / DAY + 1;
  const employedDays = (employed.to.getTime() - employed.from.getTime()) / DAY + 1;
  const base = employedDays === monthDays ? input.workingDays : (input.workingDays * employedDays) / monthDays;
  return round2(Math.max(0, base - input.lopDays));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Mask a sensitive identifier for display: only the last four characters are shown. */
export function mask(value: string | null | undefined): string {
  if (!value) return "—";
  const v = value.replace(/\s+/g, "");
  return v.length <= 4 ? "••••" : `${"•".repeat(Math.min(8, v.length - 4))}${v.slice(-4)}`;
}
