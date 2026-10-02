import "server-only";
import { InvoiceStatus } from "@/generated/prisma/client";
import { toMinor } from "@/lib/domain/money";
import { loadStudentFor, offeringWhere } from "@/server/auth/access";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden } from "@/server/errors";
import { studentAttendance } from "@/server/services/attendance";
import { balanceFor, invoiceWhere } from "@/server/services/finance";
import { stockLevels } from "@/server/services/inventory";
import { portalSubject } from "@/server/services/portal";
import { studentResults } from "@/server/services/results";
import { studentFilterWhere } from "@/server/services/students";

/**
 * Read operations shared by the REST API and the AI connector. Every function takes the caller's context
 * and applies the same permission checks and record scoping as the website, and returns plain data with
 * only the fields an outside tool needs.
 */

const rupees = (d: { toString(): string } | null | undefined) => toMinor(d) / 100;

export async function me(ctx: AuthContext) {
  return {
    id: ctx.user.id, name: ctx.user.name, email: ctx.user.email, type: ctx.user.userType, designation: ctx.user.designation, department: ctx.user.departmentName,
    roles: ctx.roles.map((r) => r.name),
    studentId: ctx.subject.studentId, wardStudentIds: ctx.subject.wardStudentIds,
  };
}

/** A student's own (or a guardian's ward's) attendance, results and fee balance. */
export async function selfSummary(ctx: AuthContext, studentId?: string) {
  const p = await portalSubject(ctx, studentId);
  const term = await db.academicTerm.findFirst({ where: { isCurrent: true } });
  const [attendance, results, balance] = await Promise.all([
    p.canAcademic && term ? studentAttendance(ctx, p.student.id, term.id) : null,
    p.canAcademic ? studentResults(ctx, p.student.id) : null,
    p.canFinance ? balanceFor(ctx, p.student.id) : null,
  ]);
  return {
    student: { id: p.student.id, studentNo: p.student.studentNo, name: `${p.student.firstName} ${p.student.lastName}`, programme: p.student.program.name, semester: p.student.currentSemester },
    term: term?.name ?? null,
    attendance: attendance && { overallPercent: attendance.overallPercent, minimumPercent: attendance.policy.minimumPercent, courses: attendance.classes.map((c) => ({ code: c.code, title: c.title, percent: c.summary.percent, attended: c.summary.attended, held: c.summary.counted, standing: c.summary.standing })) },
    results: results && { cgpa: results.cgpa === null ? null : Number(results.cgpa), terms: results.terms.slice(0, 8).map((t) => ({ sgpa: t.sgpa, cgpa: t.cgpa, credits: t.creditsEarned })), courses: results.courses.filter((c) => c.publishedAt).slice(0, 40).map((c) => ({ term: c.run.term.name, code: c.course.code, title: c.course.title, grade: c.grade, gradePoint: c.gradePoint, status: c.status })) },
    fees: balance && { outstanding: balance.outstanding / 100, overdueInvoices: balance.overdue },
  };
}

/** Classes in the next days for the caller (as student, or as teacher). */
export async function upcomingClasses(ctx: AuthContext, days = 7) {
  const now = new Date();
  const meetings = await db.classMeeting.findMany({
    where: { status: "SCHEDULED", startsAt: { gte: now, lt: new Date(now.getTime() + days * 86_400_000) }, offering: offeringWhere(ctx) },
    include: { offering: { include: { course: { select: { code: true, title: true } } } }, room: { select: { code: true } } },
    orderBy: { startsAt: "asc" }, take: 200,
  });
  return meetings.map((m) => ({ startsAt: m.startsAt, endsAt: m.endsAt, course: m.offering.course.code, title: m.offering.course.title, section: m.offering.section, room: m.room?.code ?? null }));
}

export async function listStudents(ctx: AuthContext, f: { q?: string; departmentId?: string; status?: string; take: number; skip: number }) {
  if (!can(ctx, "student.view")) throw forbidden();
  const where = studentFilterWhere(ctx, { q: f.q, departmentId: f.departmentId, status: f.status });
  const [total, rows] = await Promise.all([
    db.student.count({ where }),
    db.student.findMany({ where, include: { program: { select: { code: true } }, department: { select: { code: true } } }, orderBy: { studentNo: "asc" }, take: f.take, skip: f.skip }),
  ]);
  return { total, items: rows.map((s) => ({ id: s.id, studentNo: s.studentNo, name: `${s.firstName} ${s.lastName}`, email: s.email, programme: s.program.code, department: s.department.code, semester: s.currentSemester, section: s.section, status: s.status })) };
}

export async function getStudent(ctx: AuthContext, id: string) {
  if (!can(ctx, "student.view")) throw forbidden();
  const s = await loadStudentFor(ctx, id);
  const full = await db.student.findUniqueOrThrow({ where: { id: s.id }, include: { program: { select: { code: true, name: true } }, department: { select: { code: true, name: true } }, batch: { select: { code: true } } } });
  return { id: full.id, studentNo: full.studentNo, admissionNo: full.admissionNo, name: `${full.firstName} ${full.lastName}`, email: full.email, programme: full.program, department: full.department, batch: full.batch?.code ?? null, semester: full.currentSemester, section: full.section, status: full.status, admittedOn: full.admittedOn };
}

export async function listCourses(ctx: AuthContext, f: { q?: string; take: number; skip: number }) {
  if (!can(ctx, "academic.view") && !ctx.subject.studentId) throw forbidden();
  const where = f.q ? { OR: [{ code: { contains: f.q, mode: "insensitive" as const } }, { title: { contains: f.q, mode: "insensitive" as const } }] } : {};
  const rows = await db.course.findMany({ where, include: { department: { select: { code: true } }, program: { select: { code: true } } }, orderBy: { code: "asc" }, take: f.take, skip: f.skip });
  return rows.map((c) => ({ id: c.id, code: c.code, title: c.title, credits: c.credits, type: c.courseType, mode: c.mode, department: c.department.code, programme: c.program.code }));
}

export async function listInvoices(ctx: AuthContext, f: { status?: string; studentId?: string; take: number; skip: number }) {
  const where = { AND: [await invoiceWhere(ctx), ...(f.studentId ? [{ studentId: f.studentId }] : []), ...(f.status && f.status in InvoiceStatus ? [{ status: f.status as InvoiceStatus }] : [])] };
  const rows = await db.invoice.findMany({ where, include: { student: { select: { studentNo: true } } }, orderBy: { issueDate: "desc" }, take: f.take, skip: f.skip });
  return rows.map((i) => ({ id: i.id, number: i.number, student: i.student.studentNo, status: i.status, total: rupees(i.total), paid: rupees(i.amountPaid), dueDate: i.dueDate, issuedAt: i.issueDate }));
}

export async function upcomingEvents() {
  const rows = await db.campusEvent.findMany({ where: { status: "PUBLISHED", endsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" }, take: 50 });
  return rows.map((e) => ({ id: e.id, title: e.title, venue: e.venue, startsAt: e.startsAt, endsAt: e.endsAt, capacity: e.capacity }));
}

export async function operationsSnapshot(ctx: AuthContext) {
  const out: Record<string, unknown> = {};
  if (can(ctx, "inventory.manage")) {
    const { rows } = await stockLevels();
    out.stock = rows.map((r) => ({ code: r.item.code, name: r.item.name, unit: r.item.unit, onHand: r.total, reorderLevel: r.item.reorderLevel, low: r.low && r.item.reorderLevel > 0 }));
  }
  if (can(ctx, "asset.manage")) out.assets = (await db.asset.groupBy({ by: ["status"], _count: true })).map((g) => ({ status: g.status, count: g._count }));
  if (can(ctx, "facility.manage") || ctx.user.userType === "STAFF") {
    out.bookings = (await db.facilityBooking.findMany({ where: { status: { in: ["APPROVED", "REQUESTED"] }, endsAt: { gte: new Date() }, ...(can(ctx, "facility.manage") ? {} : { bookedById: ctx.user.id }) }, include: { room: { select: { code: true } } }, orderBy: { startsAt: "asc" }, take: 50 }))
      .map((b) => ({ room: b.room.code, title: b.title, startsAt: b.startsAt, endsAt: b.endsAt, status: b.status }));
  }
  if (!Object.keys(out).length) throw forbidden();
  return out;
}
