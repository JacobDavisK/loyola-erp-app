/**
 * Degree audit (pure). Evaluates a student's academic record against a curriculum version:
 * total credits, every mandatory course, elective-group credits, credit requirements by course type
 * (e.g. project, internship), and a minimum CGPA. Requirements are data on the curriculum, not code.
 */
import { z } from "zod";

export const extraRequirementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CATEGORY_CREDITS"), label: z.string().min(2).max(80), courseTypes: z.array(z.string()).min(1), minCredits: z.number().min(0) }),
  z.object({ kind: z.literal("MIN_CGPA"), label: z.string().min(2).max(80).default("Minimum CGPA"), value: z.number().min(0).max(10) }),
]);
export type ExtraRequirement = z.infer<typeof extraRequirementSchema>;
export const extraRequirementsSchema = z.array(extraRequirementSchema).max(20);

export interface CurriculumSpec {
  totalCredits: number;
  minCgpa: number | null;
  courses: { courseId: string; code: string; title: string; credits: number; semester: number; category: "MANDATORY" | "ELECTIVE"; groupCode: string | null; courseType: string }[];
  groups: { code: string; name: string; minCredits: number }[];
  requirements: ExtraRequirement[];
}

export interface RecordEntry {
  courseId: string;
  code: string;
  credits: number;
  courseType: string;
  passed: boolean;
  attempts: number;
}

export interface AuditResult {
  requiredCredits: number;
  earnedCredits: number;
  percent: number;
  mandatory: { total: number; done: number; remaining: { code: string; title: string; semester: number }[] };
  electives: { code: string; name: string; required: number; earned: number; met: boolean }[];
  categories: { label: string; required: number; earned: number; met: boolean }[];
  cgpa: { required: number; actual: number | null; met: boolean } | null;
  failed: { code: string; attempts: number }[];
  repeated: { code: string; attempts: number }[];
  eligible: boolean;
  blockers: string[];
}

export function auditDegree(spec: CurriculumSpec, record: RecordEntry[], cgpa: number | null): AuditResult {
  const passed = new Map(record.filter((r) => r.passed).map((r) => [r.courseId, r]));
  // Credits count once per course, however many attempts it took.
  const earnedCredits = [...passed.values()].reduce((a, r) => a + r.credits, 0);
  const mandatory = spec.courses.filter((c) => c.category === "MANDATORY");
  const remaining = mandatory.filter((c) => !passed.has(c.courseId)).sort((a, b) => a.semester - b.semester || a.code.localeCompare(b.code));
  const electives = spec.groups.map((g) => {
    const earned = spec.courses.filter((c) => c.groupCode === g.code && passed.has(c.courseId)).reduce((a, c) => a + c.credits, 0);
    return { code: g.code, name: g.name, required: g.minCredits, earned, met: earned >= g.minCredits };
  });
  const categories = spec.requirements
    .filter((r): r is Extract<ExtraRequirement, { kind: "CATEGORY_CREDITS" }> => r.kind === "CATEGORY_CREDITS")
    .map((r) => {
      const earned = [...passed.values()].filter((p) => r.courseTypes.includes(p.courseType)).reduce((a, p) => a + p.credits, 0);
      return { label: r.label, required: r.minCredits, earned, met: earned >= r.minCredits };
    });
  const minCgpa = Math.max(spec.minCgpa ?? 0, ...spec.requirements.filter((r) => r.kind === "MIN_CGPA").map((r) => (r as { value: number }).value));
  const cgpaCheck = minCgpa > 0 ? { required: minCgpa, actual: cgpa, met: cgpa !== null && cgpa >= minCgpa } : null;
  const failed = record.filter((r) => !r.passed && !passed.has(r.courseId)).map((r) => ({ code: r.code, attempts: r.attempts }));
  const repeated = record.filter((r) => r.attempts > 1).map((r) => ({ code: r.code, attempts: r.attempts }));

  const blockers: string[] = [];
  if (earnedCredits < spec.totalCredits) blockers.push(`${spec.totalCredits - earnedCredits} more credit(s) needed`);
  if (remaining.length) blockers.push(`${remaining.length} mandatory course(s) outstanding`);
  for (const e of electives) if (!e.met) blockers.push(`${e.name}: ${e.required - e.earned} more elective credit(s)`);
  for (const c of categories) if (!c.met) blockers.push(`${c.label}: ${c.required - c.earned} more credit(s)`);
  if (cgpaCheck && !cgpaCheck.met) blockers.push(cgpaCheck.actual === null ? `CGPA of at least ${cgpaCheck.required} (not available until results are published)` : `CGPA ${cgpaCheck.actual} is below the required ${cgpaCheck.required}`);

  return {
    requiredCredits: spec.totalCredits,
    earnedCredits,
    percent: spec.totalCredits ? Math.min(100, Math.round((earnedCredits / spec.totalCredits) * 100)) : 0,
    mandatory: { total: mandatory.length, done: mandatory.length - remaining.length, remaining: remaining.map((c) => ({ code: c.code, title: c.title, semester: c.semester })) },
    electives,
    categories,
    cgpa: cgpaCheck,
    failed,
    repeated,
    eligible: blockers.length === 0,
    blockers,
  };
}
