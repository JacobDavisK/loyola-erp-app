/**
 * Blueprint engine: marks calculation, distribution analysis and compliance validation.
 * Distribution percentages are marks-weighted (the convention for question-paper blueprints).
 */
import type { BlueprintDimension } from "@/generated/prisma/enums";
import type { BlueprintSpec, PaperItemData, PaperSectionData } from "@/lib/domain/paper-types";

export type CheckStatus = "pass" | "warn" | "fail";

export interface ComplianceCheck {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
  weight: number;
}

export interface DistributionRow {
  key: string;
  target: number | null;
  actual: number;
  tolerance: number;
  status: CheckStatus;
}

export interface BlueprintReport {
  totalQuestions: number;
  requiredQuestions: number;
  totalMarks: number;
  requiredMarks: number;
  compliance: number; // 0 … 100
  checks: ComplianceCheck[];
  sections: {
    label: string;
    title: string;
    actualCount: number;
    requiredCount: number;
    marks: number;
    requiredMarks: number;
    status: CheckStatus;
    issues: string[];
  }[];
  distributions: Record<BlueprintDimension, DistributionRow[]>;
}

/** Effective marks of a section: "answer any N of M" counts the N highest-mark items. */
export function sectionMarks(section: Pick<PaperSectionData, "attemptCount" | "items">): number {
  const marks = section.items.map((i) => i.marks).sort((a, b) => b - a);
  const n = section.attemptCount && section.attemptCount > 0 ? Math.min(section.attemptCount, marks.length) : marks.length;
  return marks.slice(0, n).reduce((s, m) => s + m, 0);
}

export function paperMarks(sections: Pick<PaperSectionData, "attemptCount" | "items">[]): number {
  return sections.reduce((s, sec) => s + sectionMarks(sec), 0);
}

export function blueprintMarks(bp: Pick<BlueprintSpec, "sections">): number {
  return bp.sections.reduce((s, sec) => s + sec.attemptCount * sec.marksPerQuestion, 0);
}

function dimensionKey(item: PaperItemData, dim: BlueprintDimension): string | null {
  switch (dim) {
    case "DIFFICULTY":
      return item.difficulty;
    case "BLOOM":
      return item.bloom;
    case "UNIT":
      return String(item.unitNumber);
    case "OUTCOME":
      return item.outcomeCode;
    case "QUESTION_TYPE":
      return item.type;
  }
}

/** Marks-weighted percentage distribution of items along one dimension. */
export function distribution(items: PaperItemData[], dim: BlueprintDimension): Map<string, number> {
  const total = items.reduce((s, i) => s + i.marks, 0);
  const acc = new Map<string, number>();
  if (total === 0) return acc;
  for (const item of items) {
    const k = dimensionKey(item, dim);
    if (k == null) continue;
    acc.set(k, (acc.get(k) ?? 0) + item.marks);
  }
  for (const [k, v] of acc) acc.set(k, Math.round((v / total) * 1000) / 10);
  return acc;
}

const DIMENSIONS: BlueprintDimension[] = ["DIFFICULTY", "BLOOM", "UNIT", "OUTCOME", "QUESTION_TYPE"];

const STATUS_SCORE: Record<CheckStatus, number> = { pass: 1, warn: 0.5, fail: 0 };

export function validateAgainstBlueprint(sections: PaperSectionData[], bp: BlueprintSpec): BlueprintReport {
  const items = sections.flatMap((s) => s.items);
  const checks: ComplianceCheck[] = [];

  // ── Sections ────────────────────────────────────────────────
  const sectionReports = bp.sections.map((spec) => {
    const sec = sections.find((s) => s.label.trim().toUpperCase() === spec.label.trim().toUpperCase());
    const issues: string[] = [];
    if (!sec) {
      return {
        label: spec.label,
        title: spec.title,
        actualCount: 0,
        requiredCount: spec.questionCount,
        marks: 0,
        requiredMarks: spec.attemptCount * spec.marksPerQuestion,
        status: "fail" as CheckStatus,
        issues: [`Section ${spec.label} is missing`],
      };
    }
    const count = sec.items.length;
    if (count < spec.questionCount) issues.push(`${spec.questionCount - count} question(s) missing`);
    if (count > spec.questionCount) issues.push(`${count - spec.questionCount} question(s) over the blueprint`);
    const wrongMarks = sec.items.filter((i) => i.marks !== spec.marksPerQuestion);
    if (wrongMarks.length) issues.push(`${wrongMarks.length} question(s) not worth ${spec.marksPerQuestion} marks`);
    if (spec.questionTypes.length) {
      const wrongType = sec.items.filter((i) => !spec.questionTypes.includes(i.type));
      if (wrongType.length) issues.push(`${wrongType.length} question(s) of a type not allowed here`);
    }
    if (spec.units.length) {
      const covered = new Set(sec.items.map((i) => i.unitNumber));
      const missing = spec.units.filter((u) => !covered.has(u));
      if (missing.length && count >= spec.units.length) issues.push(`Unit(s) ${missing.join(", ")} not covered`);
      const outside = sec.items.filter((i) => !spec.units.includes(i.unitNumber));
      if (outside.length) issues.push(`${outside.length} question(s) from units outside the blueprint`);
    }
    const effectiveSection = { attemptCount: sec.attemptCount ?? spec.attemptCount, items: sec.items };
    const status: CheckStatus = issues.length === 0 ? "pass" : count === 0 ? "fail" : "warn";
    return {
      label: spec.label,
      title: spec.title,
      actualCount: count,
      requiredCount: spec.questionCount,
      marks: sectionMarks(effectiveSection),
      requiredMarks: spec.attemptCount * spec.marksPerQuestion,
      status,
      issues,
    };
  });

  const requiredQuestions = bp.sections.reduce((s, x) => s + x.questionCount, 0);
  const totalMarks = paperMarks(
    sections.map((s) => {
      const spec = bp.sections.find((b) => b.label === s.label);
      return { attemptCount: s.attemptCount ?? spec?.attemptCount ?? null, items: s.items };
    }),
  );

  // Marks
  checks.push({
    key: "marks",
    label: "Marks",
    status: totalMarks === bp.totalMarks ? "pass" : "fail",
    detail: totalMarks === bp.totalMarks ? `${totalMarks} marks` : `${totalMarks} of ${bp.totalMarks} marks`,
    weight: 3,
  });

  // Question count / structure
  const structureOk = sectionReports.every((s) => s.status === "pass");
  checks.push({
    key: "structure",
    label: "Sections",
    status: structureOk ? "pass" : sectionReports.some((s) => s.actualCount === 0) ? "fail" : "warn",
    detail: structureOk
      ? `${bp.sections.length} sections as specified`
      : sectionReports.filter((s) => s.status !== "pass").map((s) => `§${s.label}: ${s.issues[0]}`).join("; "),
    weight: 3,
  });

  // Unit coverage — every unit named in any section should appear somewhere
  const requiredUnits = [...new Set(bp.sections.flatMap((s) => s.units))].sort((a, b) => a - b);
  if (requiredUnits.length) {
    const covered = new Set(items.map((i) => i.unitNumber));
    const missing = requiredUnits.filter((u) => !covered.has(u));
    checks.push({
      key: "units",
      label: "Units",
      status: missing.length === 0 ? "pass" : missing.length <= 1 && items.length > 0 ? "warn" : "fail",
      detail: missing.length ? `Unit ${missing.join(", ")} not covered` : `All ${requiredUnits.length} units covered`,
      weight: 2,
    });
  }

  // Distributions
  const distributions = {} as Record<BlueprintDimension, DistributionRow[]>;
  for (const dim of DIMENSIONS) {
    const actual = distribution(items, dim);
    const rules = bp.rules.filter((r) => r.dimension === dim);
    const rows: DistributionRow[] = rules.map((r) => {
      const a = actual.get(r.key) ?? 0;
      const delta = Math.abs(a - r.targetPercent);
      const status: CheckStatus = delta <= r.tolerance ? "pass" : delta <= r.tolerance * 2 ? "warn" : "fail";
      return { key: r.key, target: r.targetPercent, actual: a, tolerance: r.tolerance, status };
    });
    for (const [k, v] of actual) {
      if (!rules.some((r) => r.key === k)) rows.push({ key: k, target: null, actual: v, tolerance: 0, status: "pass" });
    }
    distributions[dim] = rows;
    if (rules.length && items.length) {
      const worst: CheckStatus = rows.some((r) => r.status === "fail")
        ? "fail"
        : rows.some((r) => r.status === "warn")
          ? "warn"
          : "pass";
      const label = { DIFFICULTY: "Difficulty", BLOOM: "Bloom", UNIT: "Unit weightage", OUTCOME: "Outcomes", QUESTION_TYPE: "Question types" }[dim];
      const off = rows.filter((r) => r.status !== "pass" && r.target != null);
      checks.push({
        key: dim.toLowerCase(),
        label,
        status: worst,
        detail: off.length
          ? off.map((r) => `${r.key} ${r.actual}% (target ${r.target}%)`).join(", ")
          : "Within tolerance",
        weight: 2,
      });
    }
  }

  // Duplicates inside the paper
  const ids = items.map((i) => i.questionId);
  const dupes = ids.filter((id, idx) => ids.indexOf(id) !== idx);
  checks.push({
    key: "duplicates",
    label: "No repeats",
    status: dupes.length ? "fail" : "pass",
    detail: dupes.length ? `${dupes.length} question(s) appear twice` : "Each question used once",
    weight: 2,
  });

  const weight = checks.reduce((s, c) => s + c.weight, 0);
  const score = checks.reduce((s, c) => s + c.weight * STATUS_SCORE[c.status], 0);
  // Completion factor keeps an almost-empty paper from scoring high on distributions alone.
  const completion = requiredQuestions ? Math.min(1, items.length / requiredQuestions) : 1;
  const compliance = weight ? Math.round((score / weight) * 100 * (0.4 + 0.6 * completion)) : 0;

  return {
    totalQuestions: items.length,
    requiredQuestions,
    totalMarks,
    requiredMarks: bp.totalMarks,
    compliance,
    checks,
    sections: sectionReports,
    distributions,
  };
}

/** Split `n` slots by percentages using the largest-remainder method (always sums to n). */
export function apportion(n: number, weights: Record<string, number>): Record<string, number> {
  const keys = Object.keys(weights);
  const total = keys.reduce((s, k) => s + Math.max(0, weights[k]), 0);
  const out: Record<string, number> = {};
  if (!total || n <= 0) {
    for (const k of keys) out[k] = 0;
    return out;
  }
  const raw = keys.map((k) => ({ k, v: (Math.max(0, weights[k]) / total) * n }));
  let used = 0;
  for (const r of raw) {
    out[r.k] = Math.floor(r.v);
    used += out[r.k];
  }
  raw
    .sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)))
    .slice(0, n - used)
    .forEach((r) => (out[r.k] += 1));
  return out;
}
