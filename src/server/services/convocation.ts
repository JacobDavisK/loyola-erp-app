import "server-only";
import { z } from "zod";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { studentBalance } from "@/server/services/finance-core";
import { notify } from "@/server/services/notifications";

/**
 * Convocation. Graduates whose degree certificate has been issued and who owe no fees are added to the
 * convocation; they register to attend in person (with guests) or to receive the degree in absentia.
 * Seats are allotted by programme and name; on the day the office records gowns issued and degrees handed.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });
const assertManage = (ctx: AuthContext) => {
  if (!can(ctx, "convocation.manage")) throw forbidden();
};

export async function saveConvocation(ctx: AuthContext, id: string | null, raw: unknown) {
  assertManage(ctx);
  const v = z.object({ title: z.string().trim().min(5).max(200), heldOn: z.coerce.date(), venue: z.string().trim().min(3).max(200), registrationCloses: z.coerce.date(), maxGuests: z.number().int().min(0).max(10) }).parse(raw);
  if (v.registrationCloses > v.heldOn) throw invalid("Registration must close before the ceremony.");
  const c = id ? await db.convocation.update({ where: { id }, data: v }) : await db.convocation.create({ data: { ...v, createdById: ctx.user.id } });
  await audit({ ...actor(ctx), action: "convocation.save", resourceType: "convocation", resourceId: c.id, summary: v.title });
  return c;
}

/** Add every eligible graduate not yet on the list. Returns how many were added and who was held back. */
export async function addEligibleGraduates(ctx: AuthContext, convocationId: string) {
  assertManage(ctx);
  const c = await db.convocation.findUnique({ where: { id: convocationId } });
  if (!c) throw notFound("Convocation");
  if (c.status === "HELD") throw workflowError("The convocation has been held.");
  const graduates = await db.student.findMany({ where: { deletedAt: null, status: "GRADUATED", credentials: { some: { type: "DEGREE_CERTIFICATE", status: "ISSUED" } }, convocations: { none: {} } }, select: { id: true, studentNo: true, firstName: true, lastName: true, userId: true } });
  const held: { studentNo: string; name: string; reason: string }[] = [];
  const add: typeof graduates = [];
  for (const g of graduates) {
    const bal = await db.$transaction((tx) => studentBalance(tx, g.id));
    if (bal.outstanding > 0) held.push({ studentNo: g.studentNo, name: `${g.firstName} ${g.lastName}`, reason: "Fees outstanding" });
    else add.push(g);
  }
  if (add.length) {
    await db.convocationGraduate.createMany({ data: add.map((g) => ({ convocationId, studentId: g.id })), skipDuplicates: true });
    await notify({ userIds: add.map((g) => g.userId), type: "convocation.update", title: `You are invited to ${c.title}`, body: `Register by ${c.registrationCloses.toISOString().slice(0, 10)}.`, link: "/portal/convocation" });
  }
  await audit({ ...actor(ctx), action: "convocation.graduates", resourceType: "convocation", resourceId: convocationId, summary: `${add.length} added, ${held.length} held back` });
  return { added: add.length, held };
}

export async function setConvocationStatus(ctx: AuthContext, id: string, status: "REGISTRATION_OPEN" | "REGISTRATION_CLOSED" | "HELD") {
  assertManage(ctx);
  const c = await db.convocation.findUnique({ where: { id } });
  if (!c) throw notFound("Convocation");
  const order = ["PLANNED", "REGISTRATION_OPEN", "REGISTRATION_CLOSED", "HELD"];
  if (order.indexOf(status) <= order.indexOf(c.status)) throw workflowError("The convocation has already passed this stage.");
  await db.convocation.update({ where: { id }, data: { status } });
  if (status === "REGISTRATION_CLOSED") await allotSeats(id);
  await audit({ ...actor(ctx), action: "convocation.status", resourceType: "convocation", resourceId: id, summary: `${c.status} → ${status}` });
}

/** Seats for those attending in person: by programme, then name (block letter per programme). */
async function allotSeats(convocationId: string) {
  const rows = await db.convocationGraduate.findMany({ where: { convocationId, attendance: "IN_PERSON" }, include: { student: { select: { firstName: true, lastName: true, program: { select: { code: true } } } } } });
  rows.sort((a, b) => a.student.program.code.localeCompare(b.student.program.code) || `${a.student.lastName} ${a.student.firstName}`.localeCompare(`${b.student.lastName} ${b.student.firstName}`));
  const programmes = [...new Set(rows.map((r) => r.student.program.code))];
  const counters = new Map<string, number>();
  for (const r of rows) {
    const p = r.student.program.code;
    const n = (counters.get(p) ?? 0) + 1;
    counters.set(p, n);
    await db.convocationGraduate.update({ where: { id: r.id }, data: { seatNo: `${String.fromCharCode(65 + programmes.indexOf(p))}-${String(n).padStart(3, "0")}` } });
  }
}

export async function registerForConvocation(ctx: AuthContext, convocationId: string, raw: unknown) {
  const studentId = ctx.subject.studentId;
  if (!studentId) throw forbidden();
  const v = z.object({ attendance: z.enum(["IN_PERSON", "IN_ABSENTIA"]), guests: z.number().int().min(0).max(10) }).parse(raw);
  const g = await db.convocationGraduate.findUnique({ where: { convocationId_studentId: { convocationId, studentId } }, include: { convocation: true } });
  if (!g) throw notFound("Invitation");
  if (g.convocation.status !== "REGISTRATION_OPEN" || g.convocation.registrationCloses < new Date()) throw workflowError("Registration is not open.");
  if (v.attendance === "IN_PERSON" && v.guests > g.convocation.maxGuests) throw invalid(`You may bring up to ${g.convocation.maxGuests} guest(s).`);
  await db.convocationGraduate.update({ where: { id: g.id }, data: { attendance: v.attendance, guests: v.attendance === "IN_PERSON" ? v.guests : 0, registeredAt: new Date() } });
}

export async function markHandover(ctx: AuthContext, graduateId: string, what: "gown" | "degree") {
  assertManage(ctx);
  const g = await db.convocationGraduate.findUnique({ where: { id: graduateId } });
  if (!g) throw notFound("Graduate");
  await db.convocationGraduate.update({ where: { id: graduateId }, data: what === "gown" ? { gownIssuedAt: g.gownIssuedAt ? null : new Date() } : { degreeHandedAt: g.degreeHandedAt ? null : new Date() } });
}
