/**
 * Course-registration eligibility (pure). The server gathers the facts; this decides.
 * Every blocking reason is returned, not just the first, so students see everything to fix.
 */

export interface RegistrationFacts {
  studentStatus: string;
  /** Registration window of the term */
  window: { opensAt: Date | null; closesAt: Date | null };
  now: Date;
  /** Registrar/HoD registering on the student's behalf may bypass the window */
  staffOverride: boolean;
  offering: { status: string; capacity: number; registered: number; programId: string | null; batchId: string | null; credits: number; courseId: string };
  student: { programId: string; batchId: string };
  alreadyRegisteredCourseIds: string[];
  creditsThisTerm: number;
  maxCreditsPerTerm: number;
  /** prerequisite course ids, with whether the student has passed each */
  prerequisites: { courseId: string; code: string; passed: boolean }[];
  /** Offering meets at the same time as one of the student's other registrations */
  clashesWith: string[];
}

export interface Violation {
  code: "STATUS" | "WINDOW" | "CLOSED" | "FULL" | "PROGRAM" | "DUPLICATE" | "CREDITS" | "PREREQUISITE" | "CLASH";
  message: string;
  /** Staff can override these; the rest are hard rules */
  overridable: boolean;
}

export function registrationViolations(f: RegistrationFacts): Violation[] {
  const v: Violation[] = [];
  if (f.studentStatus !== "ACTIVE") v.push({ code: "STATUS", message: `The student's status is ${f.studentStatus.toLowerCase().replace("_", " ")}; only active students can register.`, overridable: false });
  const { opensAt, closesAt } = f.window;
  const inWindow = (!opensAt || f.now >= opensAt) && (!closesAt || f.now <= closesAt);
  if (!inWindow && !f.staffOverride) v.push({ code: "WINDOW", message: opensAt && f.now < opensAt ? "Registration has not opened yet." : "Registration for this term has closed.", overridable: true });
  if (f.offering.status !== "OPEN" && !(f.staffOverride && f.offering.status === "PLANNED")) v.push({ code: "CLOSED", message: "This class is not open for registration.", overridable: false });
  if (f.offering.registered >= f.offering.capacity) v.push({ code: "FULL", message: `The class is full (${f.offering.capacity} seats).`, overridable: true });
  // Sections tied to a batch are reserved for it; open sections accept any programme (cross-programme electives).
  if (f.offering.batchId && f.offering.batchId !== f.student.batchId) v.push({ code: "PROGRAM", message: "This section is reserved for another batch.", overridable: true });
  if (f.alreadyRegisteredCourseIds.includes(f.offering.courseId)) v.push({ code: "DUPLICATE", message: "The student is already registered for this course this term.", overridable: false });
  if (f.creditsThisTerm + f.offering.credits > f.maxCreditsPerTerm) {
    v.push({ code: "CREDITS", message: `This would take the term load to ${f.creditsThisTerm + f.offering.credits} credits (maximum ${f.maxCreditsPerTerm}).`, overridable: true });
  }
  const missing = f.prerequisites.filter((p) => !p.passed);
  if (missing.length) v.push({ code: "PREREQUISITE", message: `Prerequisite not completed: ${missing.map((p) => p.code).join(", ")}.`, overridable: true });
  if (f.clashesWith.length) v.push({ code: "CLASH", message: `Timetable clash with ${f.clashesWith.join(", ")}.`, overridable: true });
  return v;
}

/** Violations that remain after a staff override. */
export function blocking(violations: Violation[], staffOverride: boolean): Violation[] {
  return staffOverride ? violations.filter((x) => !x.overridable) : violations;
}
