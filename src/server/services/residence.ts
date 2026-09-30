import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { dateOnly } from "@/lib/domain/hr";
import { toMinor } from "@/lib/domain/money";
import { type AuthContext, can } from "@/server/auth/current";
import { db, type Tx } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { issueInvoice } from "@/server/services/finance-core";
import { notify } from "@/server/services/notifications";

/**
 * Hostels (rooms and bed allocations) and transport (routes, stops and student passes). Capacity is enforced
 * by database triggers under a row lock; one open hostel allocation per student by a partial unique index.
 * Fees are raised as invoices on the fee head of the matching category, linked back by sourceType/sourceId.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().min(0).max(10_000_000);

async function studentByNo(no: string) {
  const s = await db.student.findFirst({ where: { studentNo: no.trim().toUpperCase(), deletedAt: null } });
  if (!s) throw notFound("Student");
  if (s.status !== "ACTIVE") throw workflowError(`${s.studentNo} is not an active student.`);
  return s;
}

async function feeInvoice(tx: Tx, ctx: AuthContext, category: "HOSTEL" | "TRANSPORT", studentId: string, amountMinor: number, description: string, source: { type: string; id: string }) {
  const head = await tx.feeHead.findFirst({ where: { category, isActive: true }, orderBy: { code: "asc" } });
  if (!head) throw invalid(`Create an active fee head of category ${category.toLowerCase()} under Finance → Fee setup to raise the fee.`);
  const term = await tx.academicTerm.findFirst({ where: { isCurrent: true }, select: { id: true } });
  const inv = await issueInvoice(tx, { studentId, termId: term?.id ?? null, dueDate: new Date(Date.now() + 15 * 86_400_000), lines: [{ feeHeadId: head.id, description, amount: amountMinor }], sourceType: source.type, sourceId: source.id }, { id: ctx.user.id, name: ctx.user.name });
  return inv.id;
}

// ───────────────────────── Hostels ─────────────────────────

export const hostelSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,12}$/),
  name: z.string().trim().min(2).max(120),
  campusId: z.string().nullable().optional().or(z.literal("")),
  gender: z.enum(["FEMALE", "MALE"]).nullable().optional().or(z.literal("")),
  wardenId: z.string().nullable().optional().or(z.literal("")),
  feePerTerm: money,
  isActive: z.boolean().default(true),
});

export async function saveHostel(ctx: AuthContext, id: string | null, raw: unknown) {
  if (!can(ctx, "hostel.manage")) throw forbidden();
  const v = hostelSchema.parse(raw);
  const data = { code: v.code, name: v.name, campusId: v.campusId || null, gender: (v.gender || null) as "FEMALE" | "MALE" | null, wardenId: v.wardenId || null, feePerTerm: v.feePerTerm.toFixed(2), isActive: v.isActive };
  const h = id ? await db.hostel.update({ where: { id }, data }) : await db.hostel.create({ data });
  await audit({ ...actor(ctx), action: id ? "hostel.update" : "hostel.create", resourceType: "hostel", resourceId: h.id, summary: `${h.code} ${h.name}` });
  return h;
}

/** Add rooms in bulk, e.g. numbers "101-110, 201-205" with the same capacity. Existing numbers are skipped. */
export async function addRooms(ctx: AuthContext, hostelId: string, raw: unknown) {
  if (!can(ctx, "hostel.manage")) throw forbidden();
  const v = z.object({ numbers: z.string().trim().min(1).max(500), capacity: z.number().int().min(1).max(50) }).parse(raw);
  const nums: string[] = [];
  for (const part of v.numbers.split(/[,\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) {
      const [a, b] = [Number(m[1]), Number(m[2])];
      if (b < a || b - a > 200) throw invalid(`Invalid range ${part}.`);
      for (let n = a; n <= b; n++) nums.push(String(n).padStart(m[1].length, "0"));
    } else if (/^[A-Za-z0-9-]{1,10}$/.test(part)) nums.push(part.toUpperCase());
    else throw invalid(`Invalid room number ${part}.`);
  }
  const existing = new Set((await db.hostelRoom.findMany({ where: { hostelId }, select: { number: true } })).map((r) => r.number));
  const fresh = [...new Set(nums)].filter((n) => !existing.has(n));
  await db.hostelRoom.createMany({ data: fresh.map((number) => ({ hostelId, number, capacity: v.capacity, floor: /^\d{3,}$/.test(number) ? Math.floor(Number(number) / 100) : 0 })) });
  await audit({ ...actor(ctx), action: "hostel.rooms.add", resourceType: "hostel", resourceId: hostelId, summary: `${fresh.length} room(s) added, ${nums.length - fresh.length} already existed` });
  return { added: fresh.length, skipped: nums.length - fresh.length };
}

export async function allocateBed(ctx: AuthContext, raw: unknown) {
  if (!can(ctx, "hostel.manage")) throw forbidden();
  const v = z.object({ studentNo: z.string().min(2), roomId: z.string().min(1), fromDate: ymd, raiseFee: z.boolean().default(true) }).parse(raw);
  const [s, room] = await Promise.all([studentByNo(v.studentNo), db.hostelRoom.findUnique({ where: { id: v.roomId }, include: { hostel: true } })]);
  if (!room || !room.isActive || !room.hostel.isActive) throw notFound("Room");
  if (room.hostel.gender && s.gender && room.hostel.gender !== s.gender) throw invalid(`${room.hostel.name} is a ${room.hostel.gender.toLowerCase()} hostel.`);
  if (await db.hostelAllocation.count({ where: { studentId: s.id, vacatedAt: null } })) throw conflict(`${s.studentNo} already has a bed. Vacate it first to move rooms.`);
  return db.$transaction(async (tx) => {
    const a = await tx.hostelAllocation.create({ data: { roomId: room.id, studentId: s.id, fromDate: dateOnly(v.fromDate), allocatedById: ctx.user.id } });
    const fee = toMinor(room.hostel.feePerTerm);
    if (v.raiseFee && fee > 0) {
      const invoiceId = await feeInvoice(tx, ctx, "HOSTEL", s.id, fee, `Hostel fee — ${room.hostel.name}, room ${room.number}`, { type: "hostelAllocation", id: a.id });
      await tx.hostelAllocation.update({ where: { id: a.id }, data: { invoiceId } });
    }
    if (s.userId) await notify({ userIds: [s.userId], type: "hostel.allocated", title: `Hostel room allotted: ${room.hostel.name}, room ${room.number}`, link: "/portal/services" }, tx);
    await audit({ ...actor(ctx), action: "hostel.allocate", resourceType: "hostelAllocation", resourceId: a.id, summary: `${s.studentNo} → ${room.hostel.code}/${room.number}` }, tx);
    return a;
  });
}

export async function vacateBed(ctx: AuthContext, allocationId: string, raw: unknown) {
  if (!can(ctx, "hostel.manage")) throw forbidden();
  const v = z.object({ date: ymd, reason: z.string().trim().min(3).max(300) }).parse(raw);
  const a = await db.hostelAllocation.findUnique({ where: { id: allocationId }, include: { student: { select: { studentNo: true } } } });
  if (!a || a.vacatedAt) throw notFound("Allocation");
  const date = dateOnly(v.date);
  if (date < a.fromDate) throw invalid("The vacating date is before the allocation started.");
  await db.hostelAllocation.update({ where: { id: allocationId }, data: { vacatedAt: date, vacateReason: v.reason } });
  await audit({ ...actor(ctx), action: "hostel.vacate", resourceType: "hostelAllocation", resourceId: allocationId, summary: `${a.student.studentNo}: ${v.reason}` });
}

// ───────────────────────── Transport ─────────────────────────

export const routeSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,12}$/),
  name: z.string().trim().min(2).max(120),
  vehicle: z.string().trim().max(40).nullable().optional(),
  driver: z.string().trim().max(120).nullable().optional(),
  capacity: z.number().int().min(1).max(200),
  stops: z.string().trim().min(3).max(5000),
  feePerTerm: money,
  isActive: z.boolean().default(true),
});

/** Stops are entered one per line as "Stop name | 07:15". */
export function parseStops(text: string) {
  const stops = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name, time = ""] = l.split("|").map((x) => x.trim());
    if (!name || (time && !/^\d{2}:\d{2}$/.test(time))) throw invalid(`Invalid stop line "${l}" (use: Stop name | 07:15).`);
    return { name, time: time || null };
  });
  if (!stops.length) throw invalid("Add at least one stop.");
  if (new Set(stops.map((s) => s.name.toLowerCase())).size !== stops.length) throw invalid("Stop names must be unique on a route.");
  return stops;
}

export async function saveRoute(ctx: AuthContext, id: string | null, raw: unknown) {
  if (!can(ctx, "transport.manage")) throw forbidden();
  const v = routeSchema.parse(raw);
  const data = { code: v.code, name: v.name, vehicle: v.vehicle || null, driver: v.driver || null, capacity: v.capacity, stops: parseStops(v.stops) as Prisma.InputJsonValue, feePerTerm: v.feePerTerm.toFixed(2), isActive: v.isActive };
  const r = id ? await db.transportRoute.update({ where: { id }, data }) : await db.transportRoute.create({ data });
  await audit({ ...actor(ctx), action: id ? "transport.route.update" : "transport.route.create", resourceType: "transportRoute", resourceId: r.id, summary: `${r.code} ${r.name}` });
  return r;
}

export async function issuePass(ctx: AuthContext, raw: unknown) {
  if (!can(ctx, "transport.manage")) throw forbidden();
  const v = z.object({ studentNo: z.string().min(2), routeId: z.string().min(1), stop: z.string().trim().min(1), validFrom: ymd, validTo: ymd, raiseFee: z.boolean().default(true) }).parse(raw);
  const [s, route] = await Promise.all([studentByNo(v.studentNo), db.transportRoute.findUnique({ where: { id: v.routeId } })]);
  if (!route || !route.isActive) throw notFound("Route");
  const stops = route.stops as { name: string }[];
  const stop = stops.find((x) => x.name.toLowerCase() === v.stop.toLowerCase());
  if (!stop) throw invalid(`"${v.stop}" is not a stop on ${route.code}.`);
  const from = dateOnly(v.validFrom);
  const to = dateOnly(v.validTo);
  if (to < from) throw invalid("The pass ends before it starts.");
  if (await db.transportPass.count({ where: { studentId: s.id, cancelledAt: null, validFrom: { lte: to }, validTo: { gte: from } } })) throw conflict(`${s.studentNo} already has a pass for these dates.`);
  return db.$transaction(async (tx) => {
    const p = await tx.transportPass.create({ data: { routeId: route.id, studentId: s.id, stop: stop.name, validFrom: from, validTo: to, issuedById: ctx.user.id } });
    const fee = toMinor(route.feePerTerm);
    if (v.raiseFee && fee > 0) {
      const invoiceId = await feeInvoice(tx, ctx, "TRANSPORT", s.id, fee, `Transport fee — route ${route.code} (${stop.name})`, { type: "transportPass", id: p.id });
      await tx.transportPass.update({ where: { id: p.id }, data: { invoiceId } });
    }
    if (s.userId) await notify({ userIds: [s.userId], type: "transport.pass", title: `Transport pass issued: route ${route.code}, ${stop.name}`, link: "/portal/services" }, tx);
    await audit({ ...actor(ctx), action: "transport.pass", resourceType: "transportPass", resourceId: p.id, summary: `${s.studentNo} → ${route.code} @ ${stop.name}` }, tx);
    return p;
  });
}

export async function cancelPass(ctx: AuthContext, passId: string, reason: string) {
  if (!can(ctx, "transport.manage")) throw forbidden();
  if (String(reason ?? "").trim().length < 3) throw invalid("Give a reason.");
  const p = await db.transportPass.findUnique({ where: { id: passId } });
  if (!p || p.cancelledAt) throw notFound("Pass");
  await db.transportPass.update({ where: { id: passId }, data: { cancelledAt: new Date() } });
  await audit({ ...actor(ctx), action: "transport.pass.cancel", resourceType: "transportPass", resourceId: passId, summary: reason });
}
