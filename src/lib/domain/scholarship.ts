/**
 * Scholarship eligibility rules (pure). Criteria are data on the scheme; every rule is optional.
 */
import { z } from "zod";

export const criteriaSchema = z.object({
  minCgpa: z.number().min(0).max(10).nullable().optional(),
  minAttendancePercent: z.number().min(0).max(100).nullable().optional(),
  maxFamilyIncome: z.number().min(0).nullable().optional(),
  programCodes: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  genders: z.array(z.string()).optional(),
  minSemester: z.number().int().min(1).max(16).nullable().optional(),
  noFailures: z.boolean().optional(),
});
export type Criteria = z.infer<typeof criteriaSchema>;

export interface ApplicantFacts {
  cgpa: number | null;
  attendancePercent: number | null;
  declaredIncome: number | null;
  programCode: string;
  category: string | null;
  gender: string | null;
  semester: number;
  failures: number;
  status: string;
}

export interface CheckResult {
  eligible: boolean;
  checks: { rule: string; ok: boolean; detail: string }[];
}

export function checkEligibility(criteria: Criteria, f: ApplicantFacts): CheckResult {
  const checks: CheckResult["checks"] = [];
  const add = (rule: string, ok: boolean, detail: string) => checks.push({ rule, ok, detail });
  add("Active student", f.status === "ACTIVE", `Status: ${f.status.toLowerCase()}`);
  if (criteria.minCgpa != null) add("Minimum CGPA", f.cgpa !== null && f.cgpa >= criteria.minCgpa, `CGPA ${f.cgpa ?? "not available"}; required ${criteria.minCgpa}`);
  if (criteria.minAttendancePercent != null) add("Minimum attendance", f.attendancePercent !== null && f.attendancePercent >= criteria.minAttendancePercent, `Attendance ${f.attendancePercent ?? "—"}%; required ${criteria.minAttendancePercent}%`);
  if (criteria.maxFamilyIncome != null) add("Family income limit", f.declaredIncome !== null && f.declaredIncome <= criteria.maxFamilyIncome, f.declaredIncome === null ? "Income not declared" : `Declared ${f.declaredIncome}; limit ${criteria.maxFamilyIncome}`);
  if (criteria.programCodes?.length) add("Programme", criteria.programCodes.includes(f.programCode), `Programme ${f.programCode}`);
  if (criteria.categories?.length) add("Category", !!f.category && criteria.categories.includes(f.category), `Category ${f.category ?? "not recorded"}`);
  if (criteria.genders?.length) add("Gender", !!f.gender && criteria.genders.includes(f.gender), "Restricted by gender");
  if (criteria.minSemester != null) add("Semester", f.semester >= criteria.minSemester, `Semester ${f.semester}; from ${criteria.minSemester}`);
  if (criteria.noFailures) add("No outstanding failures", f.failures === 0, `${f.failures} course(s) not yet passed`);
  return { eligible: checks.every((c) => c.ok), checks };
}
