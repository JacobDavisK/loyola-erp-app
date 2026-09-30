/**
 * Blueprint-driven paper generation.
 *
 * Deterministic for a given seed. Greedy slot filling scored on:
 *   difficulty / Bloom / unit / outcome deficits, reuse penalty, similarity to already-chosen questions.
 * It never "blindly" fills: if no eligible question exists for a slot it leaves the slot empty
 * and reports the shortfall.
 */
import type { BloomLevel, Difficulty, QuestionType } from "@/generated/prisma/enums";
import { apportion } from "@/lib/domain/blueprint";
import type { BlueprintSpec } from "@/lib/domain/paper-types";
import { compareQuestions } from "@/lib/domain/similarity";

export interface Candidate {
  id: string;
  code: string;
  text: string;
  marks: number;
  type: QuestionType;
  difficulty: Difficulty;
  bloom: BloomLevel;
  unitNumber: number;
  outcomeCode: string | null;
  topic: string | null;
  usageCount: number;
  /** used in one of the recent sessions (cool-off window) */
  recentlyUsed: boolean;
}

export interface GenerationOptions {
  seed: number;
  /** only (re)generate these section labels; others are kept */
  sections?: string[];
  /** already placed question ids per section label (kept sections) */
  keep?: Record<string, string[]>;
  excludeIds?: string[];
  allowRecentReuse?: boolean;
  duplicateThreshold?: number;
}

export interface RuleCheck {
  key: "units" | "difficulty" | "bloom" | "reuse" | "duplicates" | "marks";
  label: string;
  ok: boolean;
  detail: string;
}

export interface GenerationResult {
  sections: Record<string, string[]>; // section label → question ids (ordered)
  shortfalls: { section: string; missing: number; reason: string }[];
  rules: RuleCheck[];
}

export interface PoolAnalysis {
  section: string;
  needed: number;
  eligible: number;
  fresh: number;
  byDifficulty: Record<string, number>;
  ok: boolean;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function eligibleFor(section: BlueprintSpec["sections"][number], c: Candidate): boolean {
  if (c.marks !== section.marksPerQuestion) return false;
  if (section.questionTypes.length && !section.questionTypes.includes(c.type)) return false;
  if (section.units.length && !section.units.includes(c.unitNumber)) return false;
  return true;
}

export function analysePool(bp: BlueprintSpec, pool: Candidate[], allowRecentReuse = false): PoolAnalysis[] {
  return bp.sections.map((s) => {
    const eligible = pool.filter((c) => eligibleFor(s, c));
    const fresh = eligible.filter((c) => !c.recentlyUsed);
    const byDifficulty: Record<string, number> = { EASY: 0, MODERATE: 0, HARD: 0 };
    for (const c of allowRecentReuse ? eligible : fresh) byDifficulty[c.difficulty]++;
    return {
      section: s.label,
      needed: s.questionCount,
      eligible: eligible.length,
      fresh: fresh.length,
      byDifficulty,
      ok: (allowRecentReuse ? eligible.length : fresh.length) >= s.questionCount,
    };
  });
}

export function generatePaper(bp: BlueprintSpec, pool: Candidate[], opts: GenerationOptions): GenerationResult {
  const rand = mulberry32(opts.seed);
  const threshold = opts.duplicateThreshold ?? 0.6;
  const exclude = new Set(opts.excludeIds ?? []);
  const byId = new Map(pool.map((c) => [c.id, c]));
  const targetSections = new Set(opts.sections ?? bp.sections.map((s) => s.label));

  const chosen: Record<string, string[]> = {};
  const allChosen: Candidate[] = [];
  for (const s of bp.sections) {
    if (!targetSections.has(s.label)) {
      chosen[s.label] = (opts.keep?.[s.label] ?? []).filter((id) => byId.has(id));
      for (const id of chosen[s.label]) allChosen.push(byId.get(id)!);
    }
  }

  const rulesFor = (dim: string) =>
    Object.fromEntries(bp.rules.filter((r) => r.dimension === dim).map((r) => [r.key, r.targetPercent]));
  const diffTargets = rulesFor("DIFFICULTY");
  const bloomTargets = rulesFor("BLOOM");
  const outcomeTargets = rulesFor("OUTCOME");

  // Distribution targets are marks-weighted over the whole paper, so deficits are tracked in marks.
  const paperItemMarks = bp.sections.reduce((s, x) => s + x.questionCount * x.marksPerQuestion, 0);
  const marksOf = (fn: (c: Candidate) => string | null, key: string) =>
    allChosen.filter((c) => fn(c) === key).reduce((s, c) => s + c.marks, 0);
  const deficitScore = (targets: Record<string, number>, fn: (c: Candidate) => string | null, c: Candidate, weight: number) => {
    const key = fn(c);
    if (key == null || targets[key] === undefined) return Object.keys(targets).length ? -weight : 0;
    const deficit = (targets[key] / 100) * paperItemMarks - marksOf(fn, key);
    return deficit >= c.marks * 0.5 ? weight : deficit > 0 ? weight * 0.3 : -weight;
  };

  const shortfalls: GenerationResult["shortfalls"] = [];
  let reusedRecent = 0;
  let duplicateRejections = 0;

  // Fill the heaviest sections first; small-mark questions then fine-tune the distribution.
  const order = [...bp.sections].sort((a, b) => b.marksPerQuestion - a.marksPerQuestion);
  for (const section of order) {
    if (!targetSections.has(section.label)) continue;
    const n = section.questionCount;
    const units = section.units.length ? section.units : [...new Set(pool.map((c) => c.unitNumber))].sort();
    const unitQuota = apportion(n, Object.fromEntries(units.map((u) => [String(u), 1])));

    const picked: Candidate[] = [];
    const count = (fn: (c: Candidate) => string | null, key: string) => picked.filter((c) => fn(c) === key).length;

    for (let slot = 0; slot < n; slot++) {
      let best: { c: Candidate; score: number } | null = null;
      for (const c of pool) {
        if (exclude.has(c.id) || !eligibleFor(section, c)) continue;
        if (allChosen.some((x) => x.id === c.id)) continue;
        if (c.recentlyUsed && !opts.allowRecentReuse) continue;

        let score = rand() * 0.5; // variety
        score += deficitScore(diffTargets, (x) => x.difficulty, c, 3);
        score += deficitScore(bloomTargets, (x) => x.bloom, c, 2);
        if (c.outcomeCode && outcomeTargets[c.outcomeCode] !== undefined) score += deficitScore(outcomeTargets, (x) => x.outcomeCode, c, 1);
        const uq = unitQuota[String(c.unitNumber)];
        if (uq !== undefined) score += uq - count((x) => String(x.unitNumber), String(c.unitNumber)) > 0 ? 2.5 : -1;
        score -= Math.min(2, c.usageCount * 0.25);
        if (c.recentlyUsed) score -= 3;
        if (best && score <= best.score) continue;

        // similarity is the expensive check — only run it for a would-be winner
        const tooSimilar = allChosen.some(
          (x) => compareQuestions({ text: x.text, topic: x.topic }, { text: c.text, topic: c.topic }).score >= threshold,
        );
        if (tooSimilar) {
          duplicateRejections++;
          continue;
        }
        best = { c, score };
      }
      if (!best) {
        shortfalls.push({
          section: section.label,
          missing: n - picked.length,
          reason: `No further eligible ${section.marksPerQuestion}-mark questions${section.units.length ? ` in unit(s) ${section.units.join(", ")}` : ""}.`,
        });
        break;
      }
      if (best.c.recentlyUsed) reusedRecent++;
      picked.push(best.c);
      allChosen.push(best.c);
    }
    // present in unit order, then difficulty (easy → hard) — the conventional paper layout
    const diffRank: Record<Difficulty, number> = { EASY: 0, MODERATE: 1, HARD: 2 };
    picked.sort((a, b) => a.unitNumber - b.unitNumber || diffRank[a.difficulty] - diffRank[b.difficulty]);
    chosen[section.label] = picked.map((c) => c.id);
  }

  // ── Rule report ────────────────────────────────────────────
  const final = bp.sections.flatMap((s) => (chosen[s.label] ?? []).map((id) => byId.get(id)!)).filter(Boolean);
  const totalMarks = bp.sections.reduce(
    (sum, s) => sum + Math.min(s.attemptCount, (chosen[s.label] ?? []).length) * s.marksPerQuestion,
    0,
  );
  const reqUnits = [...new Set(bp.sections.flatMap((s) => s.units))];
  const coveredUnits = new Set(final.map((c) => c.unitNumber));
  const missingUnits = reqUnits.filter((u) => !coveredUnits.has(u));
  const weighted = (fn: (c: Candidate) => string, targets: Record<string, number>) => {
    const total = final.reduce((s, c) => s + c.marks, 0) || 1;
    return Object.entries(targets).every(([k, t]) => {
      const actual = (final.filter((c) => fn(c) === k).reduce((s, c) => s + c.marks, 0) / total) * 100;
      return Math.abs(actual - t) <= 10;
    });
  };

  const rules: RuleCheck[] = [
    {
      key: "units",
      label: "Unit coverage",
      ok: missingUnits.length === 0,
      detail: missingUnits.length ? `Unit ${missingUnits.join(", ")} not covered` : "All required units covered",
    },
    {
      key: "difficulty",
      label: "Difficulty mix",
      ok: weighted((c) => c.difficulty, diffTargets),
      detail: "Within ±10% of blueprint targets",
    },
    {
      key: "bloom",
      label: "Bloom distribution",
      ok: weighted((c) => c.bloom, bloomTargets),
      detail: "Within ±10% of blueprint targets",
    },
    {
      key: "reuse",
      label: "Previous reuse",
      ok: reusedRecent === 0,
      detail: reusedRecent ? `${reusedRecent} recently used question(s) included` : "No questions from recent sessions",
    },
    {
      key: "duplicates",
      label: "Duplicate check",
      ok: true,
      detail: duplicateRejections ? `${duplicateRejections} similar candidate(s) skipped` : "No similar questions selected",
    },
    {
      key: "marks",
      label: "Marks validation",
      ok: totalMarks === bp.totalMarks && shortfalls.length === 0,
      detail: `${totalMarks} / ${bp.totalMarks} marks`,
    },
  ];

  return { sections: chosen, shortfalls, rules };
}
