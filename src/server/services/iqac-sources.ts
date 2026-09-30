import "server-only";
import { toMinor } from "@/lib/domain/money";
import { db } from "@/server/db";

/**
 * Metric values the platform can compute from its own records, so accreditation data is drawn from the
 * system of record instead of being re-typed. Each source returns the value, the inputs it used and a note
 * on the definition, which is stored with the response when the data owner adopts it.
 *
 * The period is the cycle's academic year, extended back by `yearsCovered − 1` years where the metric is
 * cumulative (publications, grants).
 */

export interface Period { from: Date; to: Date; label: string }
export interface Computed { value: number; unit: string; inputs: Record<string, number | string>; note: string }

const teachers = () => db.employee.count({ where: { deletedAt: null, category: "TEACHING", status: { in: ["ACTIVE", "ON_LEAVE"] }, employmentType: { in: ["PERMANENT", "PROBATION", "CONTRACT"] } } });
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export const SOURCES: Record<string, { label: string; compute: (p: Period) => Promise<Computed> }> = {
  "students.enrolled": {
    label: "Students on roll",
    async compute() {
      const n = await db.student.count({ where: { deletedAt: null, status: "ACTIVE" } });
      return { value: n, unit: "students", inputs: { activeStudents: n }, note: "Students with status Active today." };
    },
  },
  "faculty.fulltime": {
    label: "Full-time teachers",
    async compute() {
      const n = await teachers();
      return { value: n, unit: "teachers", inputs: { teachers: n }, note: "Teaching employees (permanent, probation or contract) who are active or on leave." };
    },
  },
  "ratio.studentTeacher": {
    label: "Student–teacher ratio",
    async compute() {
      const [s, t] = await Promise.all([db.student.count({ where: { deletedAt: null, status: "ACTIVE" } }), teachers()]);
      return { value: t ? round(s / t) : 0, unit: "students per teacher", inputs: { activeStudents: s, teachers: t }, note: "Active students ÷ full-time teachers." };
    },
  },
  "faculty.phdPercent": {
    label: "Teachers with a PhD (%)",
    async compute() {
      const list = await db.employee.findMany({ where: { deletedAt: null, category: "TEACHING", status: { in: ["ACTIVE", "ON_LEAVE"] } }, select: { qualifications: true } });
      const phd = list.filter((e) => Array.isArray(e.qualifications) && (e.qualifications as { degree?: string }[]).some((q) => /ph\.?\s*d/i.test(q.degree ?? ""))).length;
      return { value: list.length ? round((phd / list.length) * 100, 1) : 0, unit: "%", inputs: { teachers: list.length, withPhd: phd }, note: "Teachers whose recorded qualifications include a PhD." };
    },
  },
  "publications.count": {
    label: "Verified publications in the period",
    async compute(p) {
      const [y1, y2] = [p.from.getUTCFullYear(), p.to.getUTCFullYear()];
      const n = await db.publication.count({ where: { verifiedAt: { not: null }, year: { gte: y1, lte: y2 } } });
      return { value: n, unit: "publications", inputs: { fromYear: y1, toYear: y2, verified: n }, note: "Publications verified by the research office, by year of publication." };
    },
  },
  "publications.perFaculty": {
    label: "Publications per teacher",
    async compute(p) {
      const [y1, y2] = [p.from.getUTCFullYear(), p.to.getUTCFullYear()];
      const [n, t] = await Promise.all([db.publication.count({ where: { verifiedAt: { not: null }, year: { gte: y1, lte: y2 } } }), teachers()]);
      return { value: t ? round(n / t) : 0, unit: "publications per teacher", inputs: { publications: n, teachers: t, fromYear: y1, toYear: y2 }, note: "Verified publications ÷ full-time teachers." };
    },
  },
  "publications.indexed": {
    label: "Scopus / Web of Science / UGC-CARE publications",
    async compute(p) {
      const [y1, y2] = [p.from.getUTCFullYear(), p.to.getUTCFullYear()];
      const n = await db.publication.count({ where: { verifiedAt: { not: null }, year: { gte: y1, lte: y2 }, indexing: { in: ["SCOPUS", "WEB_OF_SCIENCE", "UGC_CARE"] } } });
      return { value: n, unit: "publications", inputs: { fromYear: y1, toYear: y2, indexed: n }, note: "Verified publications indexed in Scopus, Web of Science or the UGC-CARE list." };
    },
  },
  "research.grants": {
    label: "Research grants sanctioned (amount)",
    async compute(p) {
      const list = await db.researchProject.findMany({ where: { status: { in: ["SANCTIONED", "COMPLETED"] }, startDate: { gte: p.from, lte: p.to } }, select: { sanctionedAmount: true } });
      const total = list.reduce((a, x) => a + toMinor(x.sanctionedAmount), 0) / 100;
      return { value: round(total), unit: "currency", inputs: { projects: list.length, amount: total }, note: "Sum of sanctioned amounts of projects that started in the period." };
    },
  },
  "research.projects": {
    label: "Research projects sanctioned",
    async compute(p) {
      const n = await db.researchProject.count({ where: { status: { in: ["SANCTIONED", "COMPLETED"] }, startDate: { gte: p.from, lte: p.to } } });
      return { value: n, unit: "projects", inputs: { projects: n }, note: "Projects sanctioned by an agency that started in the period." };
    },
  },
  "results.passPercent": {
    label: "Pass percentage (course results)",
    async compute(p) {
      const where = { isCurrent: true, publishedAt: { not: null }, term: { startDate: { gte: p.from, lte: p.to } } };
      const [total, pass] = await Promise.all([db.courseResult.count({ where: { ...where, status: { in: ["PASS", "FAIL", "ABSENT"] } } }), db.courseResult.count({ where: { ...where, status: "PASS" } })]);
      return { value: total ? round((pass / total) * 100, 1) : 0, unit: "%", inputs: { results: total, passed: pass }, note: "Published current course results in terms starting in the period: passed ÷ (passed + failed + absent)." };
    },
  },
  "scholarships.beneficiaries": {
    label: "Students receiving scholarships",
    async compute(p) {
      const n = await db.scholarshipApplication.findMany({ where: { status: "DISBURSED", decidedAt: { gte: p.from, lte: p.to } }, distinct: ["studentId"], select: { studentId: true } });
      return { value: n.length, unit: "students", inputs: { students: n.length }, note: "Distinct students whose scholarship was credited in the period." };
    },
  },
};

export async function computeSource(key: string, period: Period): Promise<Computed | null> {
  const s = SOURCES[key];
  return s ? s.compute(period) : null;
}
