/**
 * Attendance rules (pure). The policy is institution configuration (Configuration centre → Academic),
 * never hard-coded: which marks count as present, which are excluded from the denominator,
 * the minimum percentage for examination eligibility and the condonation band.
 */

export type Mark = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED" | "ON_DUTY" | "MEDICAL";

export interface AttendancePolicy {
  minimumPercent: number;
  /** Below the minimum but at or above this, a student may be condoned (e.g. with a fee or approval). */
  condonationPercent: number;
  presentMarks: Mark[];
  /** Marks removed from both numerator and denominator (e.g. approved medical leave). */
  excludedMarks: Mark[];
}

export const DEFAULT_ATTENDANCE_POLICY: AttendancePolicy = {
  minimumPercent: 75,
  condonationPercent: 65,
  presentMarks: ["PRESENT", "LATE", "ON_DUTY"],
  excludedMarks: ["EXCUSED", "MEDICAL"],
};

export type Standing = "OK" | "AT_RISK" | "CONDONABLE" | "SHORTAGE" | "NO_CLASSES";

export interface AttendanceSummary {
  held: number;
  counted: number;
  attended: number;
  excluded: number;
  percent: number | null;
  standing: Standing;
  /** Classes the student can still miss while staying at or above the minimum (given `remaining` future classes). */
  canMiss: number | null;
  /** Consecutive future classes the student must attend to reach the minimum, if currently below it. */
  mustAttend: number | null;
}

/**
 * @param marks the student's marks for classes already held
 * @param remaining classes still scheduled in the term (for the can-miss / must-attend projection)
 */
export function summarise(marks: Mark[], policy: AttendancePolicy, remaining = 0): AttendanceSummary {
  const excluded = marks.filter((m) => policy.excludedMarks.includes(m)).length;
  const counted = marks.length - excluded;
  const attended = marks.filter((m) => policy.presentMarks.includes(m)).length;
  if (counted === 0) return { held: marks.length, counted, attended, excluded, percent: null, standing: "NO_CLASSES", canMiss: null, mustAttend: null };
  const percent = Math.round((attended / counted) * 1000) / 10;
  const min = policy.minimumPercent / 100;
  const totalAtEnd = counted + remaining;
  // Largest k such that (attended + remaining - k) / totalAtEnd >= min
  const canMiss = Math.max(0, Math.floor(attended + remaining - min * totalAtEnd));
  // Smallest n such that (attended + n) / (counted + n) >= min  →  n >= (min*counted - attended) / (1 - min)
  const mustAttend = percent >= policy.minimumPercent ? 0 : min >= 1 ? null : Math.ceil((min * counted - attended) / (1 - min) - 1e-9);
  const standing: Standing =
    percent >= policy.minimumPercent ? (canMiss <= 2 && remaining > 0 ? "AT_RISK" : "OK") : percent >= policy.condonationPercent ? "CONDONABLE" : "SHORTAGE";
  return { held: marks.length, counted, attended, excluded, percent, standing, canMiss, mustAttend };
}

export const STANDING_LABEL: Record<Standing, string> = {
  OK: "Meets requirement",
  AT_RISK: "At risk",
  CONDONABLE: "Condonation needed",
  SHORTAGE: "Shortage",
  NO_CLASSES: "No classes yet",
};
