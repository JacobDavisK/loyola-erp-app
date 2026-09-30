import { describe, expect, it } from "vitest";
import { annualTax, available, carryForward, checkLeave, computePayslip, dateOnly, leaveDays, mask, overlap, payableDays, periodRange, proratedQuota, type PayComponent, type TaxRegime } from "@/lib/domain/hr";

const cal = { workWeek: [1, 2, 3, 4, 5, 6], holidays: new Set(["2026-10-02"]) };

describe("leave days", () => {
  it("skips weekends and holidays", () => {
    // Thu 1 Oct → Mon 5 Oct 2026: Thu, (Fri holiday), Sat, (Sun), Mon
    expect(leaveDays(dateOnly("2026-10-01"), dateOnly("2026-10-05"), false, cal)).toBe(3);
    expect(leaveDays(dateOnly("2026-10-04"), dateOnly("2026-10-04"), false, cal)).toBe(0);
  });
  it("counts a half day as 0.5 on a working day only", () => {
    expect(leaveDays(dateOnly("2026-10-01"), dateOnly("2026-10-01"), true, cal)).toBe(0.5);
    expect(leaveDays(dateOnly("2026-10-02"), dateOnly("2026-10-02"), true, cal)).toBe(0);
  });
  it("finds range overlaps and period bounds", () => {
    expect(overlap(dateOnly("2026-10-01"), dateOnly("2026-10-10"), dateOnly("2026-10-08"), dateOnly("2026-10-20"))?.from.toISOString().slice(0, 10)).toBe("2026-10-08");
    expect(overlap(dateOnly("2026-10-01"), dateOnly("2026-10-02"), dateOnly("2026-10-03"), dateOnly("2026-10-04"))).toBeNull();
    expect(periodRange("2026-02").days).toBe(28);
  });
});

describe("leave balances", () => {
  it("computes availability and caps carry forward", () => {
    expect(available({ entitled: 12, carriedForward: 3, used: 4.5 })).toBe(10.5);
    expect(carryForward({ entitled: 30, carriedForward: 0, used: 5 }, 10)).toBe(10);
    expect(carryForward({ entitled: 30, carriedForward: 0, used: 25 }, 10)).toBe(5);
    expect(carryForward(null, 10)).toBe(0);
  });
  it("pro-rates the quota for mid-year joiners in half days", () => {
    expect(proratedQuota(12, dateOnly("2025-06-01"), 2026)).toBe(12);
    expect(proratedQuota(12, dateOnly("2026-07-01"), 2026)).toBe(6);
    expect(proratedQuota(12, dateOnly("2027-01-01"), 2026)).toBe(0);
  });
  it("validates an application", () => {
    const base = { days: 2, halfDay: false, allowHalfDay: true, maxConsecutive: null, paid: true, balance: { entitled: 12, carriedForward: 0, used: 11 }, overlapsExisting: false };
    expect(checkLeave(base).reason).toMatch(/Only 1/);
    expect(checkLeave({ ...base, balance: { entitled: 12, carriedForward: 0, used: 0 } }).ok).toBe(true);
    expect(checkLeave({ ...base, paid: false, balance: null }).ok).toBe(true);
    expect(checkLeave({ ...base, overlapsExisting: true, balance: { entitled: 12, carriedForward: 0, used: 0 } }).ok).toBe(false);
    expect(checkLeave({ ...base, days: 0 }).ok).toBe(false);
    expect(checkLeave({ ...base, maxConsecutive: 1, balance: { entitled: 12, carriedForward: 0, used: 0 } }).ok).toBe(false);
  });
});

const regime: TaxRegime = {
  standardDeduction: 75000,
  slabs: [{ upTo: 400000, rate: 0 }, { upTo: 800000, rate: 5 }, { upTo: 1200000, rate: 10 }, { upTo: null, rate: 20 }],
  rebateLimit: 0, rebateMax: 0, cessPercent: 4,
};

describe("income tax", () => {
  it("applies slabs after the standard deduction, plus cess", () => {
    expect(annualTax(475000_00, regime)).toBe(0);
    // taxable 1,000,000: 5% of 400k + 10% of 200k = 40,000 + 4% cess = 41,600
    expect(annualTax(1075000_00, regime)).toBe(41600_00);
    // taxable 1,500,000: 20k + 40k + 20% of 300k = 120,000 → 124,800
    expect(annualTax(1575000_00, regime)).toBe(124800_00);
  });
  it("applies a rebate below the limit", () => {
    expect(annualTax(1075000_00, { ...regime, rebateLimit: 1200000, rebateMax: 60000 })).toBe(0);
  });
});

describe("payslip", () => {
  const comps: PayComponent[] = [
    { code: "DA", name: "Dearness allowance", kind: "EARNING", calc: "PERCENT_OF_BASIC", value: 50, cap: null, taxable: true, order: 1 },
    { code: "HRA", name: "House rent allowance", kind: "EARNING", calc: "PERCENT_OF_BASIC", value: 20, cap: null, taxable: true, order: 2 },
    { code: "CONV", name: "Conveyance", kind: "EARNING", calc: "FIXED", value: 1600_00, cap: null, taxable: false, order: 3 },
    { code: "PF", name: "Provident fund", kind: "DEDUCTION", calc: "PERCENT_OF_BASIC", value: 12, cap: 1800_00, taxable: false, order: 4 },
    { code: "PT", name: "Professional tax", kind: "DEDUCTION", calc: "FIXED", value: 200_00, cap: null, taxable: false, order: 5 },
    { code: "TDS", name: "Income tax", kind: "DEDUCTION", calc: "INCOME_TAX", value: 0, cap: null, taxable: false, order: 6 },
    { code: "EPF", name: "Employer PF", kind: "EMPLOYER_CONTRIBUTION", calc: "PERCENT_OF_BASIC", value: 12, cap: 1800_00, taxable: false, order: 7 },
  ];
  it("computes a full month", () => {
    const p = computePayslip({ basicMonthly: 50000_00, components: comps, workingDays: 30, payableDays: 30, tax: regime });
    expect(p.basic).toBe(50000_00);
    expect(p.gross).toBe(50000_00 + 25000_00 + 10000_00 + 1600_00);
    // taxable gross 85,000 × 12 = 1,020,000 → taxable 945,000 → 20,000 + 14,500 = 34,500 + cess 1,380 = 35,880 / 12 = 2,990
    expect(p.lines.find((l) => l.code === "TDS")?.amount).toBe(2990_00);
    expect(p.lines.find((l) => l.code === "PF")?.amount).toBe(1800_00); // capped
    expect(p.deductions).toBe(1800_00 + 200_00 + 2990_00);
    expect(p.net).toBe(p.gross - p.deductions);
    expect(p.employerContributions).toBe(1800_00);
  });
  it("pro-rates for loss of pay but not fixed deductions", () => {
    const p = computePayslip({ basicMonthly: 30000_00, components: comps.filter((c) => c.code !== "TDS"), workingDays: 30, payableDays: 15, tax: null });
    expect(p.basic).toBe(15000_00);
    expect(p.lines.find((l) => l.code === "CONV")?.amount).toBe(800_00);
    expect(p.lines.find((l) => l.code === "PT")?.amount).toBe(200_00);
  });
  it("never deducts more than gross", () => {
    const p = computePayslip({ basicMonthly: 10000_00, components: comps, workingDays: 30, payableDays: 0, tax: regime });
    expect(p.gross).toBe(0);
    expect(p.net).toBe(0);
  });
  it("derives payable days for partial months and LOP", () => {
    const { from, to } = periodRange("2026-09");
    expect(payableDays({ workingDays: 30, periodFrom: from, periodTo: to, joinDate: dateOnly("2020-01-01"), exitDate: null, lopDays: 2 })).toBe(28);
    expect(payableDays({ workingDays: 30, periodFrom: from, periodTo: to, joinDate: dateOnly("2026-09-16"), exitDate: null, lopDays: 0 })).toBe(15);
    expect(payableDays({ workingDays: 30, periodFrom: from, periodTo: to, joinDate: dateOnly("2026-10-01"), exitDate: null, lopDays: 0 })).toBe(0);
  });
  it("masks identifiers", () => {
    expect(mask("123456789012")).toBe("••••••••9012");
    expect(mask(null)).toBe("—");
  });
});
