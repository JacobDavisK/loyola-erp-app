/**
 * Result computation (pure). Every rule comes from a versioned grading scheme; nothing is hard-coded.
 *
 * Course result:
 *   internal (already scaled to the course's internal maximum) + external (scaled to the external maximum)
 *   → pass rules (overall %, minimum in the external and internal components)
 *   → optional grace marks, only when they alone close the gap and within per-course and per-student limits
 *   → grade band and grade point → credit points
 * SGPA = Σ credit points / Σ credits over the term's courses (a fail contributes 0 points but its credits count).
 * CGPA uses each course's current attempt only.
 */
import { z } from "zod";

export const bandSchema = z.object({ grade: z.string().trim().min(1).max(4), minPercent: z.number().min(0).max(100), gradePoint: z.number().min(0).max(10), pass: z.boolean() });
export const bandsSchema = z
  .array(bandSchema)
  .min(2)
  .max(15)
  .refine((b) => new Set(b.map((x) => x.grade)).size === b.length, "Grades must be unique")
  .refine((b) => b.some((x) => x.minPercent === 0), "One band must start at 0% so every mark has a grade");

export type Band = z.infer<typeof bandSchema>;

export interface GradingSpec {
  bands: Band[];
  passPercent: number;
  minExternalPercent: number;
  minInternalPercent: number;
  absentGrade: string;
  failGrade: string;
  withheldGrade: string;
  graceMaxPerCourse: number;
  gpaDecimals: number;
}

export interface CourseInput {
  credits: number;
  internalMax: number;
  externalMax: number;
  /** null when the course has no internal component recorded yet */
  internal: number | null;
  /** null when not valued yet */
  external: number | null;
  externalAbsent: boolean;
  malpractice?: boolean;
  withheld?: string | null;
}

export interface CourseOutcome {
  internalMarks: number | null;
  externalMarks: number | null;
  graceMarks: number;
  totalMarks: number | null;
  maxMarks: number;
  percent: number | null;
  grade: string;
  gradePoint: number;
  creditPoints: number;
  status: "PASS" | "FAIL" | "ABSENT" | "WITHHELD" | "INCOMPLETE";
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function bandFor(percent: number, bands: Band[]): Band {
  const sorted = [...bands].sort((a, b) => b.minPercent - a.minPercent);
  return sorted.find((b) => percent >= b.minPercent - 1e-9) ?? sorted[sorted.length - 1];
}

/**
 * @param graceAvailable grace marks still available to this student in this result run
 */
export function computeCourse(input: CourseInput, spec: GradingSpec, graceAvailable = 0): CourseOutcome {
  const maxMarks = input.internalMax + input.externalMax;
  const base = { maxMarks, graceMarks: 0 };
  if (input.withheld) {
    return { ...base, internalMarks: input.internal, externalMarks: input.external, totalMarks: null, percent: null, grade: spec.withheldGrade, gradePoint: 0, creditPoints: 0, status: "WITHHELD" };
  }
  if (input.externalMax > 0 && input.externalAbsent) {
    return { ...base, internalMarks: input.internal, externalMarks: null, totalMarks: null, percent: null, grade: spec.absentGrade, gradePoint: 0, creditPoints: 0, status: "ABSENT" };
  }
  if ((input.externalMax > 0 && input.external === null) || (input.internalMax > 0 && input.internal === null)) {
    return { ...base, internalMarks: input.internal, externalMarks: input.external, totalMarks: null, percent: null, grade: "—", gradePoint: 0, creditPoints: 0, status: "INCOMPLETE" };
  }
  const internal = input.internal ?? 0;
  let external = input.external ?? 0;
  if (input.malpractice) {
    return { ...base, internalMarks: internal, externalMarks: 0, totalMarks: internal, percent: round((internal / maxMarks) * 100), grade: spec.failGrade, gradePoint: 0, creditPoints: 0, status: "FAIL" };
  }

  const needExternal = input.externalMax > 0 ? Math.max(0, (spec.minExternalPercent / 100) * input.externalMax - external) : 0;
  const needTotal = Math.max(0, (spec.passPercent / 100) * maxMarks - (internal + external));
  const internalOk = input.internalMax === 0 || internal >= (spec.minInternalPercent / 100) * input.internalMax - 1e-9;
  // Grace is added to the external component; it cannot rescue an internal shortfall.
  let grace = 0;
  const gap = Math.ceil(Math.max(needExternal, needTotal) - 1e-9);
  if (gap > 0 && internalOk && gap <= Math.min(spec.graceMaxPerCourse, graceAvailable) && external + gap <= input.externalMax) {
    grace = gap;
    external += grace;
  }
  const total = internal + external;
  const percent = round((total / maxMarks) * 100);
  const pass =
    internalOk &&
    percent >= spec.passPercent - 1e-9 &&
    (input.externalMax === 0 || external >= (spec.minExternalPercent / 100) * input.externalMax - 1e-9);
  if (!pass) {
    return { maxMarks, graceMarks: 0, internalMarks: internal, externalMarks: input.external, totalMarks: round(internal + (input.external ?? 0)), percent: round(((internal + (input.external ?? 0)) / maxMarks) * 100), grade: spec.failGrade, gradePoint: 0, creditPoints: 0, status: "FAIL" };
  }
  const band = bandFor(percent, spec.bands);
  const gradePoint = band.pass ? band.gradePoint : 0;
  return {
    maxMarks, graceMarks: grace, internalMarks: internal, externalMarks: round(external - grace), totalMarks: round(total), percent,
    grade: band.pass ? band.grade : spec.failGrade, gradePoint, creditPoints: round(gradePoint * input.credits), status: band.pass ? "PASS" : "FAIL",
  };
}

export interface GpaEntry {
  courseId: string;
  credits: number;
  gradePoint: number;
  status: CourseOutcome["status"];
}

/** Grade-point average; withheld and incomplete courses are left out until they are resolved. */
export function gpa(entries: GpaEntry[], decimals = 2): { gpa: number | null; credits: number; creditsEarned: number; creditPoints: number } {
  const counted = entries.filter((e) => e.status === "PASS" || e.status === "FAIL" || e.status === "ABSENT");
  const credits = counted.reduce((a, e) => a + e.credits, 0);
  const creditPoints = counted.reduce((a, e) => a + e.credits * (e.status === "PASS" ? e.gradePoint : 0), 0);
  const creditsEarned = counted.filter((e) => e.status === "PASS").reduce((a, e) => a + e.credits, 0);
  return { gpa: credits ? round(creditPoints / credits, decimals) : null, credits, creditsEarned, creditPoints: round(creditPoints) };
}

/**
 * Cumulative GPA over a student's whole record: for each course, the latest attempt counts
 * (a later pass replaces an earlier fail).
 */
export function cgpa(history: (GpaEntry & { attempt: number })[], decimals = 2) {
  const latest = new Map<string, GpaEntry & { attempt: number }>();
  for (const e of history) {
    const cur = latest.get(e.courseId);
    if (!cur || e.attempt > cur.attempt) latest.set(e.courseId, e);
  }
  return gpa([...latest.values()], decimals);
}

/** Weighted sum of assessment components into course marks (e.g. two tests and an assignment → 25 internal marks). */
export function aggregateComponents(components: { maxMarks: number; weight: number; marks: number | null; status: "PRESENT" | "ABSENT" | "MALPRACTICE" | "EXEMPT" }[]) {
  let total = 0;
  let weight = 0;
  let missing = 0;
  let absent = 0;
  let malpractice = false;
  for (const c of components) {
    if (c.status === "EXEMPT") continue;
    weight += c.weight;
    if (c.status === "MALPRACTICE") malpractice = true;
    if (c.status === "ABSENT") {
      absent++;
      continue;
    }
    if (c.marks === null) {
      missing++;
      continue;
    }
    total += (Math.min(c.marks, c.maxMarks) / c.maxMarks) * c.weight;
  }
  return { marks: missing ? null : round(total), weight, absent, missing, malpractice };
}
