import { describe, expect, it } from "vitest";
import { assessRisk, checkPlan, DEFAULT_RISK_POLICY, weakOutcomes, type RiskInput } from "@/lib/domain/success";

const fine: RiskInput = { attendancePercent: 92, internalPercent: 78, activeFailures: 0, overdueAmount: 0, overdueDays: 0, daysInactive: 2, missedAssignments: 0 };

describe("early-warning risk", () => {
  it("scores a student who is doing well as low risk", () => {
    const r = assessRisk(fine);
    expect(r.level).toBe("LOW");
    expect(r.score).toBeLessThan(10);
  });
  it("flags poor attendance and marks as high risk and explains why", () => {
    const r = assessRisk({ ...fine, attendancePercent: 52, internalPercent: 28, activeFailures: 2, daysInactive: 30, missedAssignments: 2 });
    expect(r.level).toBe("HIGH");
    expect(r.factors[0].risk).toBeGreaterThan(0.8);
    expect(r.factors.map((f) => f.key)).toEqual(expect.arrayContaining(["attendance", "marks", "failures", "fees", "engagement"]));
  });
  it("spreads the weight of signals that are not available yet", () => {
    const r = assessRisk({ ...fine, attendancePercent: null, internalPercent: null, activeFailures: 3 });
    expect(r.factors.some((f) => f.key === "attendance")).toBe(false);
    // Failures carry 20 of the remaining 40 weight points → 50.
    expect(r.score).toBeGreaterThanOrEqual(50);
  });
  it("treats overdue fees by age", () => {
    const young = assessRisk({ ...fine, overdueAmount: 100000, overdueDays: 5 }).factors.find((f) => f.key === "fees")!;
    const old = assessRisk({ ...fine, overdueAmount: 100000, overdueDays: 200 }).factors.find((f) => f.key === "fees")!;
    expect(old.risk).toBeGreaterThan(young.risk);
    expect(DEFAULT_RISK_POLICY.highAt).toBeGreaterThan(DEFAULT_RISK_POLICY.mediumAt);
  });
});

describe("degree plan checks", () => {
  const codes: Record<string, string> = { a: "C101", b: "C201", c: "C301", d: "C302" };
  const base = { passed: new Set(["a"]), currentSemester: 2, maxCreditsPerSemester: 8, codeOf: (id: string) => codes[id] };
  it("needs prerequisites in an earlier semester", () => {
    const r = checkPlan({ ...base, plan: [{ courseId: "c", code: "C301", credits: 4, semester: 3, prerequisites: ["b"] }, { courseId: "b", code: "C201", credits: 4, semester: 3, prerequisites: ["a"] }], remainingMandatory: [] });
    expect(r.issues.map((i) => i.kind)).toEqual(["PREREQUISITE"]);
  });
  it("catches overloads, past semesters and missing mandatory courses, and projects the finish", () => {
    const r = checkPlan({
      ...base,
      plan: [{ courseId: "b", code: "C201", credits: 6, semester: 2, prerequisites: [] }, { courseId: "c", code: "C301", credits: 6, semester: 4, prerequisites: [] }, { courseId: "x", code: "C303", credits: 4, semester: 4, prerequisites: [] }],
      remainingMandatory: [{ courseId: "d", code: "C302" }],
    });
    expect(r.issues.map((i) => i.kind).sort()).toEqual(["MISSING_MANDATORY", "OVERLOAD", "PAST_SEMESTER"]);
    expect(r.finishesIn).toBeNull();
    const ok = checkPlan({ ...base, plan: [{ courseId: "d", code: "C302", credits: 4, semester: 3, prerequisites: ["a"] }], remainingMandatory: [{ courseId: "d", code: "C302" }] });
    expect(ok.issues).toHaveLength(0);
    expect(ok.finishesIn).toBe(3);
  });
});

describe("learning recommendations", () => {
  it("returns outcomes under the threshold, weakest first", () => {
    const w = weakOutcomes([
      { outcomeId: "co1", earned: 2, max: 10 },
      { outcomeId: "co1", earned: 3, max: 10 },
      { outcomeId: "co2", earned: 9, max: 10 },
      { outcomeId: "co3", earned: 4, max: 10 },
      { outcomeId: "co4", earned: 0, max: 0 },
    ]);
    expect(w).toEqual([{ outcomeId: "co1", percent: 25 }, { outcomeId: "co3", percent: 40 }]);
  });
});
