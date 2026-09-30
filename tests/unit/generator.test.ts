import { describe, expect, it } from "vitest";
import { validateAgainstBlueprint } from "@/lib/domain/blueprint";
import { analysePool, generatePaper, type Candidate } from "@/lib/domain/generator";
import type { PaperSectionData } from "@/lib/domain/paper-types";
import { PATTERN } from "./fixtures";

const WORDS = ["stack", "queue", "tree", "graph", "hash", "heap", "list", "array", "sort", "search", "matrix", "trie", "deque", "set", "map", "cache", "index", "pointer", "record", "string"];

function pool(): Candidate[] {
  const out: Candidate[] = [];
  let n = 0;
  const add = (marks: number, count: number) => {
    for (let i = 0; i < count; i++) {
      n++;
      const unit = (i % 5) + 1;
      const difficulty = marks === 2 ? "EASY" : marks === 5 ? (i % 4 === 0 ? "EASY" : "MODERATE") : i % 2 === 0 ? "MODERATE" : "HARD";
      out.push({
        id: `q${n}`,
        code: `Q-${n}`,
        text: `${WORDS[n % WORDS.length]} ${WORDS[(n * 7) % WORDS.length]} concept ${n} explanation variant ${n * 13}`,
        marks,
        type: "SHORT",
        difficulty,
        bloom: marks === 2 ? "REMEMBER" : marks === 5 ? "UNDERSTAND" : "APPLY",
        unitNumber: unit,
        outcomeCode: `CO${unit}`,
        topic: null,
        usageCount: 0,
        recentlyUsed: false,
      });
    }
  };
  add(2, 20);
  add(5, 15);
  add(10, 10);
  return out;
}

function toSections(ids: Record<string, string[]>, p: Candidate[]): PaperSectionData[] {
  const byId = new Map(p.map((c) => [c.id, c]));
  return PATTERN.sections.map((s) => ({
    id: s.label,
    label: s.label,
    title: s.title,
    instructions: null,
    attemptCount: s.attemptCount,
    marksPerQuestion: s.marksPerQuestion,
    items: (ids[s.label] ?? []).map((id) => {
      const c = byId.get(id)!;
      return { itemId: id, questionId: id, questionCode: c.code, versionId: id, version: 1, body: c.text, options: null, marks: c.marks, type: c.type, difficulty: c.difficulty, bloom: c.bloom, unitNumber: c.unitNumber, outcomeCode: c.outcomeCode, topic: null };
    }),
  }));
}

describe("automatic paper generation", () => {
  it("fills every section with correctly marked, unique questions", () => {
    const p = pool();
    const r = generatePaper(PATTERN, p, { seed: 42 });
    expect(r.shortfalls).toHaveLength(0);
    expect(r.sections.A).toHaveLength(10);
    expect(r.sections.B).toHaveLength(7);
    expect(r.sections.C).toHaveLength(5);
    const all = Object.values(r.sections).flat();
    expect(new Set(all).size).toBe(all.length);
    const report = validateAgainstBlueprint(toSections(r.sections, p), PATTERN);
    expect(report.totalMarks).toBe(75);
    expect(report.checks.find((c) => c.key === "units")?.status).toBe("pass");
  });

  it("is deterministic for a seed and varies across seeds", () => {
    const p = pool();
    expect(generatePaper(PATTERN, p, { seed: 7 }).sections).toEqual(generatePaper(PATTERN, p, { seed: 7 }).sections);
    expect(generatePaper(PATTERN, p, { seed: 7 }).sections).not.toEqual(generatePaper(PATTERN, p, { seed: 99 }).sections);
  });

  it("never reuses recently used questions unless allowed", () => {
    const p = pool().map((c, i) => ({ ...c, recentlyUsed: i % 3 === 0 }));
    const r = generatePaper(PATTERN, p, { seed: 3 });
    const recent = new Set(p.filter((c) => c.recentlyUsed).map((c) => c.id));
    expect(Object.values(r.sections).flat().some((id) => recent.has(id))).toBe(false);
  });

  it("reports shortfalls instead of blindly filling", () => {
    const p = pool().filter((c) => c.marks !== 10).concat(pool().filter((c) => c.marks === 10).slice(0, 2));
    const r = generatePaper(PATTERN, p, { seed: 1 });
    expect(r.shortfalls.find((s) => s.section === "C")?.missing).toBe(3);
    expect(r.rules.find((x) => x.key === "marks")?.ok).toBe(false);
  });

  it("regenerates one section while keeping the others", () => {
    const p = pool();
    const first = generatePaper(PATTERN, p, { seed: 5 });
    const second = generatePaper(PATTERN, p, { seed: 6, sections: ["B"], keep: { A: first.sections.A, C: first.sections.C } });
    expect(second.sections.A).toEqual(first.sections.A);
    expect(second.sections.C).toEqual(first.sections.C);
    expect(second.sections.B.some((id) => first.sections.A.includes(id) || first.sections.C.includes(id))).toBe(false);
  });

  it("rejects near-duplicate candidates", () => {
    const p = pool();
    p[1] = { ...p[1], text: p[0].text };
    const r = generatePaper(PATTERN, p, { seed: 2 });
    const chosen = Object.values(r.sections).flat();
    expect(chosen.includes(p[0].id) && chosen.includes(p[1].id)).toBe(false);
  });

  it("analyses pool capacity per section", () => {
    const a = analysePool(PATTERN, pool());
    expect(a.every((s) => s.ok)).toBe(true);
    expect(a.find((s) => s.section === "C")?.eligible).toBe(10);
  });
});
