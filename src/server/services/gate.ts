import "server-only";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { type AuthContext, can, isSuperAdmin } from "@/server/auth/current";
import { db } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { sendDirectSms } from "@/server/services/messaging";
import { notify } from "@/server/services/notifications";

/**
 * Campus gate. Visitors are logged at the gate (or pre-registered by their host, who shares a six-digit
 * pass code). Hostel students apply for an out-pass; their warden approves it, the guardian is told by SMS,
 * and the gate records when the student leaves and returns — a return after the deadline is flagged.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });
const assertGate = (ctx: AuthContext) => {
  if (!can(ctx, "gate.manage")) throw forbidden();
};

// ───────────────────────── Visitors ─────────────────────────

const visitorSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^[+0-9 -]{8,16}$/, "Enter a phone number"),
  purpose: z.string().trim().min(3).max(300),
  hostName: z.string().trim().max(120).nullable().optional(),
  vehicleNo: z.string().trim().max(20).nullable().optional(),
  idProof: z.string().trim().max(60).nullable().optional(),
});

/** A host (any staff member) expects a visitor: the visitor gets a pass code for quick entry. */
export async function preRegisterVisitor(ctx: AuthContext, raw: unknown) {
  if (ctx.user.userType !== "STAFF") throw forbidden();
  const v = visitorSchema.extend({ expectedAt: z.coerce.date() }).parse(raw);
  for (let i = 0; i < 5; i++) {
    const passCode = String(randomInt(100000, 1000000));
    if (await db.visitor.findUnique({ where: { passCode } })) continue;
    const row = await db.visitor.create({ data: { ...v, hostName: ctx.user.name, hostUserId: ctx.user.id, vehicleNo: v.vehicleNo ?? null, idProof: v.idProof ?? null, passCode, createdById: ctx.user.id } });
    await audit({ ...actor(ctx), action: "gate.preregister", resourceType: "visitor", resourceId: row.id, summary: `${v.name} expected` });
    return row;
  }
  throw conflict("Try again.");
}

/** Walk-in at the gate, or arrival of a pre-registered visitor by pass code. */
export async function checkInVisitor(ctx: AuthContext, raw: unknown) {
  assertGate(ctx);
  const code = z.object({ passCode: z.string().regex(/^\d{6}$/) }).safeParse(raw);
  if (code.success) {
    const v = await db.visitor.findUnique({ where: { passCode: code.data.passCode } });
    if (!v) throw notFound("Pass code");
    if (v.checkedInAt) throw workflowError("This pass has already been used.");
    if (v.expectedAt && Math.abs(v.expectedAt.getTime() - Date.now()) > 24 * 3_600_000) throw workflowError("The pass is not valid today.");
    const row = await db.visitor.update({ where: { id: v.id }, data: { checkedInAt: new Date() } });
    if (v.hostUserId) await notify({ userIds: [v.hostUserId], type: "gate.visitor", title: `${v.name} has arrived`, body: v.purpose });
    return row;
  }
  const v = visitorSchema.extend({ hostUserId: z.string().nullable().optional() }).parse(raw);
  const host = v.hostUserId ? await db.user.findUnique({ where: { id: v.hostUserId }, select: { id: true, name: true } }) : null;
  const row = await db.visitor.create({ data: { ...v, hostUserId: host?.id ?? null, hostName: host?.name ?? v.hostName ?? null, vehicleNo: v.vehicleNo ?? null, idProof: v.idProof ?? null, checkedInAt: new Date(), createdById: ctx.user.id } });
  if (host) await notify({ userIds: [host.id], type: "gate.visitor", title: `${v.name} is at the gate to see you`, body: v.purpose });
  return row;
}

export async function checkOutVisitor(ctx: AuthContext, id: string) {
  assertGate(ctx);
  const v = await db.visitor.findUnique({ where: { id } });
  if (!v?.checkedInAt) throw notFound("Visitor on campus");
  if (v.checkedOutAt) throw workflowError("Already checked out.");
  await db.visitor.update({ where: { id }, data: { checkedOutAt: new Date() } });
}

// ───────────────────────── Out-passes ─────────────────────────

async function residence(studentId: string) {
  return db.hostelAllocation.findFirst({ where: { studentId, vacatedAt: null }, include: { room: { include: { hostel: true } } } });
}

export async function applyOutpass(ctx: AuthContext, raw: unknown) {
  const studentId = ctx.subject.studentId;
  if (!studentId) throw forbidden();
  const v = z.object({ reason: z.string().trim().min(5).max(500), destination: z.string().trim().min(2).max(200), leaveAt: z.coerce.date(), returnBy: z.coerce.date() }).parse(raw);
  if (v.returnBy <= v.leaveAt) throw invalid("The return must be after leaving.");
  if (v.leaveAt.getTime() < Date.now() - 3_600_000) throw invalid("The leaving time is in the past.");
  if (v.returnBy.getTime() - v.leaveAt.getTime() > 30 * 86_400_000) throw invalid("An out-pass is for at most 30 days; apply for leave instead.");
  const res = await residence(studentId);
  if (!res) throw workflowError("Out-passes are for hostel residents.");
  if (await db.outpass.findFirst({ where: { studentId, status: { in: ["REQUESTED", "APPROVED", "OUT"] } } })) throw conflict("You already have an open out-pass.");
  const o = await db.outpass.create({ data: { studentId, ...v } });
  await notify({ userIds: [res.room.hostel.wardenId], type: "gate.outpass", title: "Out-pass request", body: `${ctx.user.name}: ${v.destination}`, link: "/gate/outpasses" });
  return o;
}

async function canDecide(ctx: AuthContext, studentId: string) {
  if (isSuperAdmin(ctx)) return true;
  const res = await residence(studentId);
  return !!res && res.room.hostel.wardenId === ctx.user.id;
}

export async function decideOutpass(ctx: AuthContext, id: string, approve: boolean, note?: string | null) {
  const o = await db.outpass.findUnique({ where: { id }, include: { student: { include: { guardians: true } } } });
  if (!o) throw notFound("Out-pass");
  if (!(await canDecide(ctx, o.studentId))) throw forbidden("The student's hostel warden decides out-passes.");
  if (o.status !== "REQUESTED") throw workflowError("Already decided.");
  if (!approve && !note?.trim()) throw invalid("Give a reason for refusing.");
  const s = o.student;
  let guardianNotified = false;
  if (approve) {
    const g = s.guardians.find((x) => x.isPrimary && x.phone) ?? s.guardians.find((x) => x.phone);
    const text = `Loyola University: ${s.firstName} ${s.lastName} has permission to leave the hostel for ${o.destination} from ${o.leaveAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} and must return by ${o.returnBy.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}.`.replace(/\s+/g, " ");
    if (g?.phone) guardianNotified = await sendDirectSms(g.phone, text, g.userId);
    await notify({ userIds: s.guardians.map((x) => x.userId), type: "gate.outpass", title: "Out-pass approved", body: text });
  }
  await db.outpass.update({ where: { id }, data: { status: approve ? "APPROVED" : "REJECTED", decidedById: ctx.user.id, decidedAt: new Date(), decisionNote: note?.trim() || null, guardianNotified } });
  await audit({ ...actor(ctx), action: approve ? "outpass.approve" : "outpass.reject", resourceType: "outpass", resourceId: id, summary: `${s.studentNo}: ${o.destination}` });
  await notify({ userIds: [s.userId], type: "gate.outpass", title: `Out-pass ${approve ? "approved" : "refused"}`, body: note ?? o.destination, link: "/portal/outpass" });
}

export async function cancelOutpass(ctx: AuthContext, id: string) {
  const o = await db.outpass.findUnique({ where: { id } });
  if (!o || o.studentId !== ctx.subject.studentId) throw notFound("Out-pass");
  if (!["REQUESTED", "APPROVED"].includes(o.status)) throw workflowError("The out-pass can no longer be cancelled.");
  await db.outpass.update({ where: { id }, data: { status: "CANCELLED" } });
}

/** At the gate: the student leaves on an approved pass, or comes back. */
export async function gateMove(ctx: AuthContext, id: string, now = new Date()) {
  assertGate(ctx);
  const o = await db.outpass.findUnique({ where: { id }, include: { student: true } });
  if (!o) throw notFound("Out-pass");
  if (o.status === "APPROVED") {
    if (now.getTime() < o.leaveAt.getTime() - 2 * 3_600_000) throw workflowError("The pass is not valid yet.");
    if (now > o.returnBy) throw workflowError("The pass has expired.");
    await db.outpass.update({ where: { id }, data: { status: "OUT", outAt: now } });
    return "OUT" as const;
  }
  if (o.status === "OUT") {
    const late = now > o.returnBy;
    await db.outpass.update({ where: { id }, data: { status: "RETURNED", inAt: now, late } });
    await audit({ ...actor(ctx), action: "outpass.return", resourceType: "outpass", resourceId: id, summary: `${o.student.studentNo}${late ? " (late)" : ""}` });
    if (late) {
      const res = await residence(o.studentId);
      await notify({ userIds: [res?.room.hostel.wardenId], type: "gate.late", title: `Late return: ${o.student.studentNo}`, body: `Due ${o.returnBy.toISOString().slice(0, 16).replace("T", " ")} UTC`, link: "/gate/outpasses" });
    }
    return "RETURNED" as const;
  }
  throw workflowError("The out-pass is not approved.");
}

/** Students who are out past their return time (for the warden and the gate). */
export async function overdueOutpasses(now = new Date()) {
  return db.outpass.findMany({ where: { status: "OUT", returnBy: { lt: now } }, include: { student: { select: { studentNo: true, firstName: true, lastName: true } } }, orderBy: { returnBy: "asc" } });
}

export async function outpassWhere(ctx: AuthContext) {
  const hostels = await db.hostel.findMany({ where: { wardenId: ctx.user.id }, select: { id: true } });
  if (isSuperAdmin(ctx) || (!hostels.length && (can(ctx, "gate.manage") || can(ctx, "hostel.manage")))) return {};
  if (!hostels.length) throw forbidden();
  return { student: { hostelAllocations: { some: { vacatedAt: null, room: { hostelId: { in: hostels.map((h) => h.id) } } } } } };
}
