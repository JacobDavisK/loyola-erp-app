import { describe, expect, it } from "vitest";
import { apportion, blueprintMarks, distribution, paperMarks, sectionMarks, validateAgainstBlueprint } from "@/lib/domain/blueprint";
import { PATTERN, compliantPaper, item, section } from "./fixtures";

describe("marks calculation", () => {
  it("counts every item when all must be answered", () => {
    expect(sectionMarks({ attemptCount: null, items: [item({ marks: 2 }), item({ marks: 2 }), item({ marks: 3 })] })).toBe(7);
  });

  it("counts only the N highest-mark items for 'answer any N'", () => {
    expect(sectionMarks({ attemptCount: 2, items: [item({ marks: 5 }), item({ marks: 10 }), item({ marks: 6 })] })).toBe(16);
  });

  it("never counts more items than exist", () => {
    expect(sectionMarks({ attemptCount: 5, items: [item({ marks: 5 })] })).toBe(5);
  });

  it("totals a 75-mark LOCF paper", () => {
    expect(paperMarks(compliantPaper())).toBe(75);
    expect(blueprintMarks(PATTERN)).toBe(75);
  });
});

describe("distribution", () => {
  it("is marks-weighted, not count-weighted", () => {
    const d = distribution([item({ marks: 2, difficulty: "EASY" }), item({ marks: 8, difficulty: "HARD" })], "DIFFICULTY");
    expect(d.get("EASY")).toBe(20);
    expect(d.get("HARD")).toBe(80);
  });

  it("returns an empty map for an empty paper", () => {
    expect(distribution([], "BLOOM").size).toBe(0);
  });
});

describe("blueprint validation", () => {
  it("passes a compliant paper with high compliance", () => {
    const r = validateAgainstBlueprint(compliantPaper(), PATTERN);
    expect(r.totalMarks).toBe(75);
    expect(r.checks.find((c) => c.key === "marks")?.status).toBe("pass");
    expect(r.checks.find((c) => c.key === "structure")?.status).toBe("pass");
    expect(r.checks.find((c) => c.key === "difficulty")?.status).toBe("pass");
    expect(r.compliance).toBeGreaterThanOrEqual(95);
  });

  it("flags missing questions and wrong totals", () => {
    const paper = compliantPaper();
    paper[0].items.pop();
    const r = validateAgainstBlueprint(paper, PATTERN);
    expect(r.totalMarks).toBe(73);
    expect(r.checks.find((c) => c.key === "marks")?.status).toBe("fail");
    expect(r.sections[0].issues[0]).toMatch(/1 question\(s\) missing/);
  });

  it("flags a missing section as a failure", () => {
    const r = validateAgainstBlueprint(compliantPaper().slice(0, 2), PATTERN);
    expect(r.sections.find((s) => s.label === "C")?.status).toBe("fail");
  });

  it("flags items that do not carry the section's marks", () => {
    const paper = compliantPaper();
    paper[1].items[0] = item({ marks: 6, unitNumber: 1 });
    const r = validateAgainstBlueprint(paper, PATTERN);
    expect(r.sections[1].issues.join(" ")).toMatch(/not worth 5 marks/);
  });

  it("detects the same question used twice", () => {
    const paper = compliantPaper();
    paper[0].items[1] = { ...paper[0].items[1], questionId: paper[0].items[0].questionId };
    expect(validateAgainstBlueprint(paper, PATTERN).checks.find((c) => c.key === "duplicates")?.status).toBe("fail");
  });

  it("flags difficulty drift outside tolerance", () => {
    const paper = compliantPaper();
    paper[2].items.forEach((i) => (i.difficulty = "HARD"));
    const diff = validateAgainstBlueprint(paper, PATTERN).checks.find((c) => c.key === "difficulty");
    expect(diff?.status).not.toBe("pass");
  });

  it("reports missing unit coverage", () => {
    const paper = [section("A", [item({ unitNumber: 1 })])];
    const units = validateAgainstBlueprint(paper, PATTERN).checks.find((c) => c.key === "units");
    expect(units?.status).toBe("fail");
    expect(units?.detail).toContain("Unit 2");
  });

  it("scales compliance down for an incomplete paper", () => {
    const partial = compliantPaper().map((s) => ({ ...s, items: s.items.slice(0, 1) }));
    expect(validateAgainstBlueprint(partial, PATTERN).compliance).toBeLessThan(60);
  });
});

describe("apportion (largest remainder)", () => {
  it("always sums to n", () => {
    const out = apportion(7, { EASY: 30, MODERATE: 50, HARD: 20 });
    expect(Object.values(out).reduce((a, b) => a + b, 0)).toBe(7);
    expect(out).toEqual({ EASY: 2, MODERATE: 4, HARD: 1 });
  });

  it("handles zero weights", () => {
    expect(apportion(3, { A: 0, B: 0 })).toEqual({ A: 0, B: 0 });
  });
});
