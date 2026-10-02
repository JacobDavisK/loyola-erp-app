import { describe, expect, it } from "vitest";
import { averageCost, budgetPosition, clashesWith, depreciation, depreciationForYear, fiscalYearOf, fiscalYearRange } from "@/lib/domain/operations";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("financial year", () => {
  it("runs from April to March", () => {
    expect(fiscalYearOf(d("2026-03-31"))).toBe("2025-26");
    expect(fiscalYearOf(d("2026-04-01"))).toBe("2026-27");
    expect(fiscalYearOf(d("2099-12-31"))).toBe("2099-00");
    const r = fiscalYearRange("2026-27");
    expect(r.from.toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(r.to.toISOString().slice(0, 10)).toBe("2027-04-01");
    expect(() => fiscalYearRange("2026")).toThrow();
  });
});

describe("depreciation", () => {
  const slm = { cost: 110_000, salvageValue: 10_000, usefulLifeYears: 5, method: "STRAIGHT_LINE" as const, wdvRate: null, purchaseDate: d("2024-04-01") };
  it("straight line spreads cost less salvage over the life and stops at salvage", () => {
    expect(depreciation(slm, d("2025-04-01")).accumulated).toBe(20_000);
    expect(depreciation(slm, d("2034-04-01")).bookValue).toBe(10_000);
    expect(depreciation(slm, d("2023-01-01")).accumulated).toBe(0);
  });
  it("written-down value applies the rate to the reducing balance", () => {
    const wdv = { ...slm, salvageValue: 0, cost: 100_000, method: "WRITTEN_DOWN_VALUE" as const, wdvRate: 15 };
    expect(depreciation(wdv, d("2025-04-01")).bookValue).toBe(85_000);
    expect(depreciation(wdv, new Date(d("2024-04-01").getTime() + 2 * 365 * 86_400_000)).bookValue).toBe(72_250);
  });
  it("charges a year pro rata from purchase and up to disposal", () => {
    const mid = { ...slm, purchaseDate: d("2024-10-01") };
    expect(depreciationForYear(mid, "2024-25")).toBeCloseTo(9_972.6, 0);
    expect(depreciationForYear(slm, "2025-26")).toBeCloseTo(20_000, 0);
    expect(depreciationForYear(slm, "2025-26", d("2025-10-01"))).toBeCloseTo(10_027, -1);
    expect(depreciationForYear(slm, "2023-24")).toBe(0);
  });
});

describe("stock valuation", () => {
  it("uses the weighted average and keeps it through issues", () => {
    expect(averageCost([{ quantity: 10, unitCost: 100 }, { quantity: 10, unitCost: 200 }])).toEqual({ quantity: 20, unitCost: 150 });
    expect(averageCost([{ quantity: 10, unitCost: 100 }, { quantity: -4, unitCost: 0 }, { quantity: 6, unitCost: 160 }])).toEqual({ quantity: 12, unitCost: 130 });
    expect(averageCost([])).toEqual({ quantity: 0, unitCost: 0 });
  });
});

describe("budgets and clashes", () => {
  it("reports what is left and flags overspending", () => {
    expect(budgetPosition(100_000, 60_000, 30_000)).toMatchObject({ available: 10_000, usedPercent: 90, over: false });
    expect(budgetPosition(100_000, 90_000, 30_000)).toMatchObject({ available: -20_000, over: true });
    expect(budgetPosition(0, 0, 0).usedPercent).toBe(0);
  });
  it("finds overlapping bookings but not back-to-back ones", () => {
    const busy = [{ startsAt: new Date("2026-10-05T04:00:00Z"), endsAt: new Date("2026-10-05T05:00:00Z"), label: "Class" }];
    expect(clashesWith(new Date("2026-10-05T04:30:00Z"), new Date("2026-10-05T06:00:00Z"), busy)).toHaveLength(1);
    expect(clashesWith(new Date("2026-10-05T05:00:00Z"), new Date("2026-10-05T06:00:00Z"), busy)).toHaveLength(0);
  });
});
