import { describe, expect, it } from "vitest";
import {
  attainmentLevel, bestExitAward, courseOutcomeAttainment, currentDecisions, DEFAULT_OBE_POLICY, exitEligibility, formatApaar, isMinor, likertToLevel, needsDecision,
  normaliseApaar, programOutcomeAttainment, transferCreditsAvailable, yearsOfStudy, type MarkTable,
} from "@/lib/domain/compliance";

describe("APAAR", () => {
  it("accepts 12 digits typed with spaces or hyphens", () => {
    expect(normaliseApaar("1234 5678-9012")).toBe("123456789012");
    expect(normaliseApaar("12345678901")).toBeNull();
    expect(normaliseApaar("12345678901A")).toBeNull();
    expect(formatApaar("123456789012")).toBe("1234 5678 9012");
  });
});

describe("NEP exits and credit transfer", () => {
  const awards = [
    { id: "c", level: 1, title: "Certificate", minCredits: 40, minYears: 1 },
    { id: "d", level: 2, title: "Diploma", minCredits: 80, minYears: 2 },
    { id: "g", level: 3, title: "Degree", minCredits: 120, minYears: 3 },
  ];
  it("needs both the credits and the years", () => {
    expect(exitEligibility(awards[0], 44, 1.1).eligible).toBe(true);
    const r = exitEligibility(awards[1], 70, 1.5);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toHaveLength(2);
  });
  it("offers the highest award earned", () => {
    expect(bestExitAward(awards, 85, 2.1)?.id).toBe("d");
    expect(bestExitAward(awards, 30, 3)).toBeNull();
  });
  it("counts whole years of study", () => {
    expect(yearsOfStudy(new Date("2024-07-01"), new Date("2026-07-15"))).toBe(2);
  });
  it("caps transfer credits at a share of the programme", () => {
    expect(transferCreditsAvailable(120, 40, 0)).toBe(48);
    expect(transferCreditsAvailable(120, 40, 45)).toBe(3);
    expect(transferCreditsAvailable(120, 40, 60)).toBe(0);
  });
});

describe("outcome attainment", () => {
  const policy = DEFAULT_OBE_POLICY; // target 60%, thresholds 40/55/70, internal 40, indirect 20
  it("maps the share of students reaching the target to a level", () => {
    expect(attainmentLevel(39.9, policy.levelThresholds)).toBe(0);
    expect(attainmentLevel(40, policy.levelThresholds)).toBe(1);
    expect(attainmentLevel(60, policy.levelThresholds)).toBe(2);
    expect(attainmentLevel(80, policy.levelThresholds)).toBe(3);
  });
  it("computes internal, external, direct and final attainment per CO", () => {
    const components = [
      { id: "t1", maxMarks: 20, external: false, outcomeIds: ["co1"] },
      { id: "t2", maxMarks: 20, external: false, outcomeIds: ["co2"] },
      { id: "ese", maxMarks: 100, external: true, outcomeIds: ["co1", "co2"] },
    ];
    const marks: MarkTable = new Map([
      ["s1", new Map([["t1", 18], ["t2", 8], ["ese", 75]])],
      ["s2", new Map([["t1", 14], ["t2", 15], ["ese", 55]])],
      ["s3", new Map([["t1", 6], ["t2", 16], ["ese", 62]])],
      ["s4", new Map<string, number | null>([["t1", 13], ["t2", null], ["ese", 40]])],
    ]);
    const [co1, co2] = courseOutcomeAttainment(["co1", "co2"], components, marks, ["s1", "s2", "s3", "s4"], policy, new Map([["co1", 3]]));
    // CO1 internal: s1 90%, s2 70%, s3 30%, s4 65% → 3 of 4 = 75% → L3. External: 75, 55, 62, 40 → 2 of 4 = 50% → L1.
    expect(co1.internal).toMatchObject({ attained: 3, sharePercent: 75, level: 3 });
    expect(co1.external).toMatchObject({ attained: 2, sharePercent: 50, level: 1 });
    expect(co1.direct).toBe(1.8); // 0.4×3 + 0.6×1
    expect(co1.final).toBe(2.04); // 0.8×1.8 + 0.2×3
    // CO2 internal: 40, 75, 80, 0 (absent counts as zero) → 2 of 4 → L1; no survey → final = direct.
    expect(co2.internal?.level).toBe(1);
    expect(co2.final).toBe(co2.direct);
  });
  it("leaves an unmeasured outcome empty rather than zero", () => {
    const [r] = courseOutcomeAttainment(["co9"], [], new Map(), ["s1"], policy);
    expect(r.direct).toBeNull();
    expect(r.final).toBeNull();
  });
  it("weights programme outcomes by correlation strength", () => {
    const res = programOutcomeAttainment(["po1", "po2"], [
      { outcomeId: "co1", programOutcomeId: "po1", strength: 3 },
      { outcomeId: "co2", programOutcomeId: "po1", strength: 1 },
      { outcomeId: "co3", programOutcomeId: "po2", strength: 2 },
    ], new Map([["co1", 2], ["co2", 3], ["co3", null]]));
    expect(res[0]).toMatchObject({ value: 2.25, contributors: 2 }); // (3×2 + 1×3) / 4
    expect(res[1].value).toBeNull();
  });
  it("converts survey means to the 0–3 scale", () => {
    expect(likertToLevel(1)).toBe(0);
    expect(likertToLevel(5)).toBe(3);
    expect(likertToLevel(4)).toBe(2.25);
  });
});

describe("DPDP", () => {
  it("knows when a person is a minor", () => {
    expect(isMinor(new Date("2008-11-01"), new Date("2026-10-31"))).toBe(true);
    expect(isMinor(new Date("2008-11-01"), new Date("2026-11-01"))).toBe(false);
    expect(isMinor(null, new Date())).toBe(false);
  });
  it("takes the latest decision and asks again after a new version", () => {
    const t = (d: string) => new Date(d);
    const cur = currentDecisions([
      { noticeKey: "dir", decision: "GRANTED" as const, version: 1, createdAt: t("2026-01-01") },
      { noticeKey: "dir", decision: "WITHDRAWN" as const, version: 1, createdAt: t("2026-03-01") },
      { noticeKey: "rec", decision: "GRANTED" as const, version: 1, createdAt: t("2026-01-01") },
    ]);
    expect(cur.get("dir")?.decision).toBe("WITHDRAWN");
    expect(needsDecision({ key: "rec", version: 1 }, cur)).toBe(false);
    expect(needsDecision({ key: "rec", version: 2 }, cur)).toBe(true);
    expect(needsDecision({ key: "dir", version: 1 }, cur)).toBe(false); // a refusal stands until they change it
    expect(needsDecision({ key: "new", version: 1 }, cur)).toBe(true);
  });
});
