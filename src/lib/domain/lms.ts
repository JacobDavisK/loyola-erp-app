/**
 * Learning-management rules (pure): submission windows and late penalties, automatic quiz grading,
 * attempt deadlines, deterministic question shuffling and scaling gradebook scores into assessment marks.
 */
import { z } from "zod";

// ───────────────────────── Assignments ─────────────────────────

export interface SubmissionWindow {
  dueAt: Date;
  closesAt: Date | null;
  latePenaltyPercent: number;
}

export type WindowCheck = { open: true; late: boolean; penalty: number } | { open: false; reason: string };

/** Whether a submission made `at` is accepted, whether it is late, and the penalty fraction (0–1). */
export function checkWindow(w: SubmissionWindow, at: Date): WindowCheck {
  if (at <= w.dueAt) return { open: true, late: false, penalty: 0 };
  if (w.closesAt && at <= w.closesAt) return { open: true, late: true, penalty: Math.min(1, Math.max(0, w.latePenaltyPercent / 100)) };
  return { open: false, reason: w.closesAt ? "The submission window has closed." : "The due time has passed and late submissions are not accepted." };
}

/** Final marks after the late penalty, rounded to two decimals. */
export function applyPenalty(marks: number, penalty: number): number {
  return Math.round(marks * (1 - penalty) * 100) / 100;
}

// ───────────────────────── Quizzes ─────────────────────────

export type QuestionType = "SINGLE" | "MULTIPLE" | "TRUE_FALSE" | "SHORT" | "NUMERIC";

export const optionSchema = z.object({ id: z.string().regex(/^[a-z0-9]{1,8}$/), text: z.string().trim().min(1).max(500) });

/** Answer keys by question type. Validated when an instructor saves a question. */
export const answerKeySchemas = {
  SINGLE: z.object({ correct: z.array(z.string()).length(1) }),
  MULTIPLE: z.object({ correct: z.array(z.string()).min(1), partial: z.boolean().default(false) }),
  TRUE_FALSE: z.object({ correct: z.boolean() }),
  SHORT: z.object({ accepted: z.array(z.string().trim().min(1).max(200)).min(1), caseSensitive: z.boolean().default(false) }),
  NUMERIC: z.object({ value: z.number(), tolerance: z.number().min(0).default(0) }),
} as const;

export interface GradableQuestion {
  id: string;
  type: QuestionType;
  marks: number;
  answer: unknown;
}

const normalise = (s: string, caseSensitive: boolean) => {
  const t = s.normalize("NFKC").trim().replace(/\s+/g, " ");
  return caseSensitive ? t : t.toLowerCase();
};

/**
 * Marks for one answer. MULTIPLE awards full marks only for the exact set, unless partial credit is on:
 * then (correct picks − wrong picks) / correct options, never below zero.
 */
export function gradeAnswer(q: GradableQuestion, response: unknown): number {
  if (response === undefined || response === null || response === "") return 0;
  switch (q.type) {
    case "SINGLE": {
      const key = answerKeySchemas.SINGLE.parse(q.answer);
      return typeof response === "string" && response === key.correct[0] ? q.marks : 0;
    }
    case "MULTIPLE": {
      const key = answerKeySchemas.MULTIPLE.parse(q.answer);
      if (!Array.isArray(response)) return 0;
      const picked = new Set(response.filter((x): x is string => typeof x === "string"));
      const correct = new Set(key.correct);
      const hits = [...picked].filter((x) => correct.has(x)).length;
      const wrong = picked.size - hits;
      if (hits === correct.size && wrong === 0) return q.marks;
      if (!key.partial) return 0;
      return Math.round((Math.max(0, hits - wrong) / correct.size) * q.marks * 100) / 100;
    }
    case "TRUE_FALSE": {
      const key = answerKeySchemas.TRUE_FALSE.parse(q.answer);
      return response === key.correct ? q.marks : 0;
    }
    case "SHORT": {
      const key = answerKeySchemas.SHORT.parse(q.answer);
      if (typeof response !== "string") return 0;
      const r = normalise(response, key.caseSensitive);
      return key.accepted.some((a) => normalise(a, key.caseSensitive) === r) ? q.marks : 0;
    }
    case "NUMERIC": {
      const key = answerKeySchemas.NUMERIC.parse(q.answer);
      const n = typeof response === "number" ? response : typeof response === "string" && response.trim() !== "" ? Number(response) : NaN;
      return Number.isFinite(n) && Math.abs(n - key.value) <= key.tolerance + 1e-9 ? q.marks : 0;
    }
  }
}

export function gradeAttempt(questions: GradableQuestion[], answers: Record<string, unknown>): { awarded: Record<string, number>; score: number; maxScore: number } {
  const awarded: Record<string, number> = {};
  for (const q of questions) awarded[q.id] = gradeAnswer(q, answers[q.id]);
  const score = Math.round(Object.values(awarded).reduce((a, b) => a + b, 0) * 100) / 100;
  return { awarded, score, maxScore: questions.reduce((a, q) => a + q.marks, 0) };
}

/** An attempt ends at the time limit or when the quiz closes, whichever is first. */
export function attemptDeadline(startedAt: Date, closesAt: Date, timeLimitMinutes: number | null): Date {
  if (!timeLimitMinutes) return closesAt;
  const t = new Date(startedAt.getTime() + timeLimitMinutes * 60_000);
  return t < closesAt ? t : closesAt;
}

/** Grace for network latency when answers arrive just after the deadline. */
export const SUBMIT_GRACE_MS = 30_000;

/** Deterministic shuffle (mulberry32 seeded from a string), so a student's order is stable across reloads. */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export type ReviewPolicy = "AFTER_SUBMIT" | "AFTER_CLOSE" | "SCORE_ONLY" | "NEVER";

/** What a student may see of a submitted attempt. */
export function reviewVisibility(policy: ReviewPolicy, closed: boolean): { score: boolean; answers: boolean } {
  switch (policy) {
    case "AFTER_SUBMIT": return { score: true, answers: true };
    case "AFTER_CLOSE": return { score: closed, answers: closed };
    case "SCORE_ONLY": return { score: true, answers: false };
    case "NEVER": return { score: false, answers: false };
  }
}

// ───────────────────────── Gradebook ─────────────────────────

/** Scale a score out of `from` into an assessment component out of `to` (two decimals). */
export function scaleScore(score: number, from: number, to: number): number {
  if (from <= 0) return 0;
  return Math.round(Math.min(score, from) * (to / from) * 100) / 100;
}
