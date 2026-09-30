import "server-only";
import { db, type Tx } from "@/server/db";

/**
 * The student's completed-course record, used for prerequisites and degree audit.
 * Published current results are the source of truth. A course with no published result yet counts as
 * passed only if its registration was completed (records migrated from before results were kept here).
 */
export async function passedCourseIds(studentId: string, client: Tx | typeof db = db): Promise<Set<string>> {
  const [results, regs] = await Promise.all([
    client.courseResult.findMany({ where: { studentId, isCurrent: true, publishedAt: { not: null } }, select: { courseId: true, status: true } }),
    client.courseRegistration.findMany({ where: { studentId, status: "COMPLETED" }, select: { offering: { select: { courseId: true } } } }),
  ]);
  const graded = new Map<string, boolean>();
  for (const r of results) graded.set(r.courseId, (graded.get(r.courseId) ?? false) || r.status === "PASS");
  const out = new Set([...graded].filter(([, passed]) => passed).map(([id]) => id));
  for (const r of regs) if (!graded.has(r.offering.courseId)) out.add(r.offering.courseId);
  return out;
}

/** Latest published CGPA of a student, or null before any result is published. */
export async function currentCgpa(studentId: string, client: Tx | typeof db = db): Promise<number | null> {
  const t = await client.termResult.findFirst({ where: { studentId, isCurrent: true, publishedAt: { not: null } }, orderBy: { publishedAt: "desc" }, select: { cgpa: true } });
  return t?.cgpa ?? null;
}

/** Attempts per course (published results), for the degree audit's repeated/failed lists. */
export async function attemptsByCourse(studentId: string, client: Tx | typeof db = db): Promise<Map<string, { attempts: number; passed: boolean }>> {
  const rows = await client.courseResult.findMany({ where: { studentId, publishedAt: { not: null } }, select: { courseId: true, attempt: true, status: true, isCurrent: true } });
  const out = new Map<string, { attempts: number; passed: boolean }>();
  for (const r of rows) {
    const cur = out.get(r.courseId) ?? { attempts: 0, passed: false };
    cur.attempts = Math.max(cur.attempts, r.attempt);
    if (r.isCurrent && r.status === "PASS") cur.passed = true;
    out.set(r.courseId, cur);
  }
  return out;
}
