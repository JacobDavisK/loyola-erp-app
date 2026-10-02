/**
 * Regulatory rules (pure): APAAR IDs, NEP 2020 exits and credit transfer, outcome-based education
 * attainment (NBA method), and DPDP Act 2023 time limits.
 */

const DAY = 86_400_000;

// ───────────────────────── APAAR / ABC ─────────────────────────

/** APAAR IDs are 12 digits. Spaces and hyphens typed by people are ignored. */
export function normaliseApaar(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  return /^[0-9]{12}$/.test(digits) ? digits : null;
}

export const formatApaar = (id: string) => id.replace(/(\d{4})(\d{4})(\d{4})/, "$1 $2 $3");

// ───────────────────────── NEP 2020: exits and credit transfer ─────────────────────────

export interface ExitAwardRule {
  id: string;
  level: number;
  title: string;
  minCredits: number;
  minYears: number;
}

/** Whole years of study, as a decimal, between admission and `at`. */
export function yearsOfStudy(admittedOn: Date, at: Date): number {
  return Math.max(0, Math.floor(((at.getTime() - admittedOn.getTime()) / (365.25 * DAY)) * 10) / 10);
}

export function exitEligibility(award: ExitAwardRule, credits: number, years: number): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (credits < award.minCredits) reasons.push(`Needs ${award.minCredits} credits; ${credits} earned.`);
  if (years < award.minYears) reasons.push(`Needs ${award.minYears} year(s) of study; ${years} completed.`);
  return { eligible: reasons.length === 0, reasons };
}

/** The highest award the student qualifies for, if any. */
export function bestExitAward<T extends ExitAwardRule>(awards: T[], credits: number, years: number): T | null {
  return [...awards].sort((a, b) => b.level - a.level).find((a) => exitEligibility(a, credits, years).eligible) ?? null;
}

/**
 * Credit transfer cap (UGC: up to 40% of a programme's credits may come from SWAYAM / online courses).
 * Returns the credits still available.
 */
export function transferCreditsAvailable(programmeCredits: number, maxPercent: number, alreadyApproved: number): number {
  return Math.max(0, Math.floor(programmeCredits * (maxPercent / 100) * 10) / 10 - alreadyApproved);
}

// ───────────────────────── Outcome-based education ─────────────────────────

export interface ObePolicy {
  /** A student "attains" an outcome when they score at least this percentage of its marks. */
  targetPercent: number;
  /** Share of students attaining the target needed for levels 1, 2 and 3. */
  levelThresholds: [number, number, number];
  /** Weight of continuous internal evaluation in direct attainment; the end-semester exam gets the rest. */
  internalWeight: number;
  /** Weight of indirect assessment (course exit survey) in the final attainment. */
  indirectWeight: number;
}

export const DEFAULT_OBE_POLICY: ObePolicy = { targetPercent: 60, levelThresholds: [40, 55, 70], internalWeight: 40, indirectWeight: 20 };

export interface ObeComponent {
  id: string;
  maxMarks: number;
  external: boolean;
  outcomeIds: string[];
}

/** marks[studentId][componentId] = marks obtained (null/absent = 0 for a registered student) */
export type MarkTable = Map<string, Map<string, number | null>>;

export function attainmentLevel(sharePercent: number, thresholds: [number, number, number]): number {
  if (sharePercent >= thresholds[2]) return 3;
  if (sharePercent >= thresholds[1]) return 2;
  if (sharePercent >= thresholds[0]) return 1;
  return 0;
}

export interface OutcomePart {
  students: number;
  attained: number;
  sharePercent: number;
  level: number;
}

export interface OutcomeAttainment {
  outcomeId: string;
  internal: OutcomePart | null;
  external: OutcomePart | null;
  direct: number | null;
  indirect: number | null;
  final: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function part(components: ObeComponent[], marks: MarkTable, students: string[], target: number, thresholds: [number, number, number]): OutcomePart | null {
  const max = components.reduce((a, c) => a + c.maxMarks, 0);
  if (!components.length || max <= 0 || !students.length) return null;
  let attained = 0;
  for (const s of students) {
    const row = marks.get(s);
    const got = components.reduce((a, c) => a + (row?.get(c.id) ?? 0), 0);
    if ((got / max) * 100 >= target) attained++;
  }
  const sharePercent = round2((attained / students.length) * 100);
  return { students: students.length, attained, sharePercent, level: attainmentLevel(sharePercent, thresholds) };
}

/**
 * Course-outcome attainment for one class. For each outcome, a student's score is the sum of the marks
 * of every component mapped to it over their maximum. The share of students reaching the target gives a
 * level (0–3) separately for internal and end-semester components; direct attainment weights the two,
 * and the final value blends in the indirect (survey) level when one is available.
 */
export function courseOutcomeAttainment(
  outcomeIds: string[],
  components: ObeComponent[],
  marks: MarkTable,
  students: string[],
  policy: ObePolicy,
  indirect: Map<string, number> = new Map(),
): OutcomeAttainment[] {
  return outcomeIds.map((outcomeId) => {
    const mapped = components.filter((c) => c.outcomeIds.includes(outcomeId));
    const internal = part(mapped.filter((c) => !c.external), marks, students, policy.targetPercent, policy.levelThresholds);
    const external = part(mapped.filter((c) => c.external), marks, students, policy.targetPercent, policy.levelThresholds);
    let direct: number | null = null;
    if (internal && external) direct = round2((internal.level * policy.internalWeight + external.level * (100 - policy.internalWeight)) / 100);
    else direct = internal?.level ?? external?.level ?? null;
    const ind = indirect.get(outcomeId) ?? null;
    const final = direct === null ? null : ind === null ? direct : round2((direct * (100 - policy.indirectWeight) + ind * policy.indirectWeight) / 100);
    return { outcomeId, internal, external, direct, indirect: ind, final };
  });
}

/**
 * Programme-outcome attainment from course-outcome attainment and the CO–PO matrix:
 * PO = Σ(strength × CO attainment) / Σ strength, over every mapped course outcome that has a value.
 */
export function programOutcomeAttainment(
  poIds: string[],
  mappings: { outcomeId: string; programOutcomeId: string; strength: number }[],
  coValues: Map<string, number | null>,
): { programOutcomeId: string; value: number | null; contributors: number }[] {
  return poIds.map((po) => {
    let num = 0;
    let den = 0;
    let contributors = 0;
    for (const m of mappings) {
      if (m.programOutcomeId !== po) continue;
      const v = coValues.get(m.outcomeId);
      if (v === null || v === undefined) continue;
      num += m.strength * v;
      den += m.strength;
      contributors++;
    }
    return { programOutcomeId: po, value: den ? round2(num / den) : null, contributors };
  });
}

/** Survey answers (1–5 Likert) to an indirect attainment level on the same 0–3 scale. */
export function likertToLevel(mean: number): number {
  return round2(Math.max(0, Math.min(3, ((mean - 1) / 4) * 3)));
}

// ───────────────────────── DPDP Act 2023 ─────────────────────────

export function isMinor(dateOfBirth: Date | null | undefined, at: Date, adultAge = 18): boolean {
  if (!dateOfBirth) return false;
  const adult = new Date(Date.UTC(dateOfBirth.getUTCFullYear() + adultAge, dateOfBirth.getUTCMonth(), dateOfBirth.getUTCDate()));
  return at < adult;
}

export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY);
export const addHours = (d: Date, hours: number) => new Date(d.getTime() + hours * 3_600_000);

/** Latest decision per notice key from an append-only ledger (newest wins). */
export function currentDecisions<T extends { noticeKey: string; decision: "GRANTED" | "WITHDRAWN"; version: number; createdAt: Date }>(rows: T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) out.set(r.noticeKey, r);
  return out;
}

/** A notice needs a (new) decision when nothing was decided, or a grant was for an older version. */
export function needsDecision(notice: { key: string; version: number }, current: Map<string, { decision: string; version: number }>): boolean {
  const c = current.get(notice.key);
  return !c || (c.decision === "GRANTED" && c.version < notice.version);
}
