/**
 * Teaching rules (pure): QR check-in geometry and time steps, document similarity for assignment
 * submissions, and survey result aggregation.
 */
import { normalize } from "@/lib/domain/similarity";

// ───────────────────────── QR self check-in ─────────────────────────

/** Great-circle distance in metres. */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** The QR code changes every `stepSeconds`; a scan is valid in the current and the previous step. */
export const QR_STEP_SECONDS = 20;
export const qrStep = (at: number, stepSeconds = QR_STEP_SECONDS) => Math.floor(at / 1000 / stepSeconds);

/**
 * Whether a location check passes. The reported accuracy is allowed for (a phone that says "within 60 m"
 * may truly be 60 m closer), but very imprecise fixes are refused so a coarse network location cannot pass.
 */
export function locationCheck(input: { lat: number; lng: number; accuracy: number }, site: { lat: number; lng: number; radius: number }): { ok: boolean; distance: number; reason?: string } {
  const distance = Math.round(distanceMeters(input.lat, input.lng, site.lat, site.lng));
  if (input.accuracy > 150) return { ok: false, distance, reason: "Your location is too imprecise. Turn on precise location (GPS) and try again." };
  if (distance - Math.min(input.accuracy, 50) > site.radius) return { ok: false, distance, reason: `You appear to be ${distance} m from the classroom; check-in is limited to ${site.radius} m.` };
  return { ok: true, distance };
}

// ───────────────────────── Document similarity ─────────────────────────

const words = (text: string) => normalize(text).split(" ").filter(Boolean);

/** Word k-gram shingles of a text. */
export function shingles(text: string, k = 5): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + k <= w.length; i++) out.add(w.slice(i, i + k).join(" "));
  return out;
}

/**
 * Overlap between two documents: the share of the smaller document's shingles found in the other
 * (containment — catches copying of part of a document), with a sample of the shared wording.
 */
export function documentSimilarity(a: Set<string>, b: Set<string>): { score: number; shared: number; sample: string | null } {
  if (!a.size || !b.size) return { score: 0, shared: 0, sample: null };
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  let sample: string | null = null;
  for (const s of small) if (big.has(s)) { shared++; sample ??= s; }
  return { score: Math.round((shared / small.size) * 1000) / 10, shared, sample };
}

/** Pairwise comparison of submissions; only pairs at or above the threshold (percent) are returned. */
export function similarityPairs<T extends { id: string; text: string }>(docs: T[], threshold = 30, k = 5) {
  const sh = docs.map((d) => ({ id: d.id, s: shingles(d.text, k) })).filter((d) => d.s.size >= 3);
  const pairs: { a: string; b: string; score: number; shared: number; sample: string | null }[] = [];
  for (let i = 0; i < sh.length; i++) {
    for (let j = i + 1; j < sh.length; j++) {
      const r = documentSimilarity(sh[i].s, sh[j].s);
      if (r.score >= threshold) pairs.push({ a: sh[i].id, b: sh[j].id, ...r });
    }
  }
  return pairs.sort((x, y) => y.score - x.score);
}

// ───────────────────────── Surveys ─────────────────────────

export interface SurveyQuestion {
  id: string;
  type: "LIKERT" | "CHOICE" | "TEXT";
  text: string;
  options?: string[];
  outcomeId?: string | null;
}

export const LIKERT_LABELS = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"] as const;

export function validateAnswers(questions: SurveyQuestion[], answers: Record<string, unknown>): string | null {
  for (const q of questions) {
    const a = answers[q.id];
    if (a === undefined || a === null || a === "") continue; // every question is optional
    if (q.type === "LIKERT" && !(Number.isInteger(a) && (a as number) >= 1 && (a as number) <= 5)) return `Answer "${q.text}" on the 1–5 scale.`;
    if (q.type === "CHOICE" && !(typeof a === "string" && q.options?.includes(a))) return `Choose one of the options for "${q.text}".`;
    if (q.type === "TEXT" && !(typeof a === "string" && a.length <= 2000)) return `Keep "${q.text}" under 2000 characters.`;
  }
  return null;
}

export interface QuestionSummary {
  id: string;
  type: SurveyQuestion["type"];
  text: string;
  answered: number;
  mean: number | null;
  distribution: Record<string, number>;
  comments: string[];
}

export function summariseSurvey(questions: SurveyQuestion[], responses: Record<string, unknown>[]): QuestionSummary[] {
  return questions.map((q) => {
    const vals = responses.map((r) => r[q.id]).filter((v) => v !== undefined && v !== null && v !== "");
    const distribution: Record<string, number> = {};
    if (q.type === "LIKERT") for (let i = 1; i <= 5; i++) distribution[String(i)] = 0;
    if (q.type === "CHOICE") for (const o of q.options ?? []) distribution[o] = 0;
    for (const v of vals) if (q.type !== "TEXT") distribution[String(v)] = (distribution[String(v)] ?? 0) + 1;
    const nums = q.type === "LIKERT" ? (vals as number[]) : [];
    return {
      id: q.id, type: q.type, text: q.text, answered: vals.length,
      mean: nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : null,
      distribution,
      comments: q.type === "TEXT" ? (vals as string[]) : [],
    };
  });
}
