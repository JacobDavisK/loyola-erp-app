/**
 * Student success rules (pure): early-warning risk scoring, degree-plan checks and outcome-based learning
 * recommendations. Every score is explainable — the factors that produced it are returned with it.
 */

export interface RiskPolicy {
  weights: { attendance: number; marks: number; failures: number; fees: number; engagement: number };
  /** Score (0–100) at which a student is medium / high risk */
  mediumAt: number;
  highAt: number;
  attendanceFloor: number;
  /** Internal-marks percentage considered comfortable; risk rises below it */
  marksComfort: number;
  inactivityDays: number;
}

export const DEFAULT_RISK_POLICY: RiskPolicy = {
  weights: { attendance: 30, marks: 30, failures: 20, fees: 10, engagement: 10 },
  mediumAt: 35,
  highAt: 60,
  attendanceFloor: 75,
  marksComfort: 60,
  inactivityDays: 14,
};

export interface RiskInput {
  /** Attendance percentage this term, or null when no classes were held yet */
  attendancePercent: number | null;
  /** Average percentage across internal assessments marked so far, or null */
  internalPercent: number | null;
  /** Courses currently failed and not yet cleared */
  activeFailures: number;
  /** Fees overdue (minor units) and the age of the oldest overdue invoice in days */
  overdueAmount: number;
  overdueDays: number;
  /** Days since the student last opened course material, submitted work or attempted a quiz; null = never */
  daysInactive: number | null;
  /** Assignments past their due date without a submission */
  missedAssignments: number;
}

export interface RiskFactor {
  key: keyof RiskPolicy["weights"];
  label: string;
  /** 0 (no concern) … 1 (maximum concern) */
  risk: number;
  weight: number;
  detail: string;
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const r2 = (n: number) => Math.round(n * 100) / 100;

export function assessRisk(input: RiskInput, policy: RiskPolicy = DEFAULT_RISK_POLICY): { score: number; level: "LOW" | "MEDIUM" | "HIGH"; factors: RiskFactor[] } {
  const w = policy.weights;
  const factors: RiskFactor[] = [];
  if (input.attendancePercent !== null) {
    const gap = policy.attendanceFloor - input.attendancePercent;
    factors.push({ key: "attendance", label: "Attendance", weight: w.attendance, risk: r2(clamp(gap / 25)), detail: `${input.attendancePercent.toFixed(1)}% (minimum ${policy.attendanceFloor}%)` });
  }
  if (input.internalPercent !== null) {
    factors.push({ key: "marks", label: "Internal marks", weight: w.marks, risk: r2(clamp((policy.marksComfort - input.internalPercent) / (policy.marksComfort - 20))), detail: `${input.internalPercent.toFixed(1)}% average so far` });
  }
  factors.push({ key: "failures", label: "Courses to clear", weight: w.failures, risk: r2(clamp(input.activeFailures / 3)), detail: input.activeFailures ? `${input.activeFailures} failed course(s) not yet cleared` : "None" });
  factors.push({ key: "fees", label: "Fees", weight: w.fees, risk: input.overdueAmount > 0 ? r2(clamp(0.5 + input.overdueDays / 240)) : 0, detail: input.overdueAmount > 0 ? `Overdue for ${input.overdueDays} day(s)` : "Nothing overdue" });
  const inactive = input.daysInactive === null ? 1 : clamp((input.daysInactive - policy.inactivityDays / 2) / (policy.inactivityDays * 1.5));
  const engagement = clamp(Math.max(inactive, input.missedAssignments / 3));
  factors.push({
    key: "engagement", label: "Engagement", weight: w.engagement, risk: r2(engagement),
    detail: `${input.daysInactive === null ? "No online activity this term" : `Last active ${input.daysInactive} day(s) ago`}${input.missedAssignments ? `; ${input.missedAssignments} missed assignment(s)` : ""}`,
  });
  // Weights of signals that are not available yet are spread over the others.
  const totalWeight = factors.reduce((a, f) => a + f.weight, 0);
  const score = totalWeight ? Math.round((factors.reduce((a, f) => a + f.risk * f.weight, 0) / totalWeight) * 1000) / 10 : 0;
  const level = score >= policy.highAt ? "HIGH" : score >= policy.mediumAt ? "MEDIUM" : "LOW";
  return { score, level, factors: factors.sort((a, b) => b.risk * b.weight - a.risk * a.weight) };
}

// ───────────────────────── Degree planner ─────────────────────────

export interface PlanCourse {
  courseId: string;
  code: string;
  credits: number;
  semester: number;
  prerequisites: string[];
}

export interface PlanIssue {
  courseId: string | null;
  semester: number | null;
  kind: "PREREQUISITE" | "OVERLOAD" | "PAST_SEMESTER" | "MISSING_MANDATORY";
  message: string;
}

/**
 * Checks a student's plan: a planned course's prerequisites must be passed or planned for an earlier
 * semester; planned credits per semester must not exceed the maximum; nothing may be planned in a
 * semester already under way or past; and every remaining mandatory course should be in the plan.
 */
export function checkPlan(input: {
  plan: PlanCourse[];
  passed: Set<string>;
  currentSemester: number;
  maxCreditsPerSemester: number;
  remainingMandatory: { courseId: string; code: string }[];
  codeOf: (courseId: string) => string;
}): { issues: PlanIssue[]; bySemester: Map<number, { credits: number; courses: PlanCourse[] }>; finishesIn: number | null } {
  const issues: PlanIssue[] = [];
  const when = new Map(input.plan.map((p) => [p.courseId, p.semester]));
  const bySemester = new Map<number, { credits: number; courses: PlanCourse[] }>();
  for (const p of [...input.plan].sort((a, b) => a.semester - b.semester || a.code.localeCompare(b.code))) {
    const s = bySemester.get(p.semester) ?? bySemester.set(p.semester, { credits: 0, courses: [] }).get(p.semester)!;
    s.credits += p.credits;
    s.courses.push(p);
    if (p.semester <= input.currentSemester) issues.push({ courseId: p.courseId, semester: p.semester, kind: "PAST_SEMESTER", message: `${p.code} is planned for semester ${p.semester}, which has already started.` });
    for (const pre of p.prerequisites) {
      if (input.passed.has(pre)) continue;
      const at = when.get(pre);
      if (at === undefined || at >= p.semester) issues.push({ courseId: p.courseId, semester: p.semester, kind: "PREREQUISITE", message: `${p.code} needs ${input.codeOf(pre)} ${at === undefined ? "first, which is not in your plan" : `in an earlier semester (planned for ${at})`}.` });
    }
  }
  for (const [sem, v] of bySemester) if (v.credits > input.maxCreditsPerSemester) issues.push({ courseId: null, semester: sem, kind: "OVERLOAD", message: `Semester ${sem} has ${v.credits} credits; the maximum is ${input.maxCreditsPerSemester}.` });
  const missing = input.remainingMandatory.filter((m) => !when.has(m.courseId));
  for (const m of missing) issues.push({ courseId: m.courseId, semester: null, kind: "MISSING_MANDATORY", message: `Mandatory course ${m.code} is not in your plan.` });
  const finishesIn = missing.length ? null : bySemester.size ? Math.max(...bySemester.keys()) : input.currentSemester;
  return { issues, bySemester, finishesIn };
}

// ───────────────────────── Learning recommendations ─────────────────────────

export interface OutcomeScore {
  outcomeId: string;
  earned: number;
  max: number;
}

/** Outcomes where the student scored below `threshold` percent, weakest first. */
export function weakOutcomes(scores: OutcomeScore[], threshold = 50): { outcomeId: string; percent: number }[] {
  const total = new Map<string, { earned: number; max: number }>();
  for (const s of scores) {
    const t = total.get(s.outcomeId) ?? total.set(s.outcomeId, { earned: 0, max: 0 }).get(s.outcomeId)!;
    t.earned += s.earned;
    t.max += s.max;
  }
  return [...total]
    .filter(([, t]) => t.max > 0)
    .map(([outcomeId, t]) => ({ outcomeId, percent: Math.round((t.earned / t.max) * 1000) / 10 }))
    .filter((o) => o.percent < threshold)
    .sort((a, b) => a.percent - b.percent);
}
