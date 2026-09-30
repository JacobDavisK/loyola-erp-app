import "server-only";
import { z } from "zod";
import { CalendarEventKind, RoomType, TermStatus, TermType } from "@/generated/prisma/enums";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { conflict, forbidden, invalid, notFound } from "@/server/errors";
import { audit } from "@/server/services/audit";

const code = (max = 16) => z.string().trim().toUpperCase().regex(new RegExp(`^[A-Z0-9-]{2,${max}}$`), `2–${max} letters, digits or dashes`);
const optStr = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => v || null);
const optDate = z.union([z.coerce.date(), z.literal("").transform(() => null), z.null()]).optional().transform((v) => v ?? null);

export const setupSchemas = {
  batch: z
    .object({
      code: code(16), name: z.string().trim().min(3).max(120), programId: z.string().min(1), regulationId: z.string().min(1),
      curriculumId: optStr(40), admissionYear: z.number().int().min(1990).max(2100), graduationYear: z.number().int().min(1990).max(2110),
    })
    .refine((v) => v.graduationYear >= v.admissionYear, { path: ["graduationYear"], message: "Must not be before the admission year" }),
  term: z
    .object({
      code: code(20), name: z.string().trim().min(3).max(80), academicYearId: z.string().min(1), termType: z.enum(TermType),
      startDate: z.coerce.date(), endDate: z.coerce.date(), registrationOpensAt: optDate, registrationClosesAt: optDate, addDropUntil: optDate,
      status: z.enum(TermStatus), isCurrent: z.boolean().default(false),
    })
    .refine((v) => v.endDate > v.startDate, { path: ["endDate"], message: "The term must end after it starts" })
    .refine((v) => !v.registrationOpensAt || !v.registrationClosesAt || v.registrationClosesAt > v.registrationOpensAt, { path: ["registrationClosesAt"], message: "Must be after registration opens" }),
  calendarEvent: z
    .object({
      title: z.string().trim().min(3).max(160), kind: z.enum(CalendarEventKind), startDate: z.coerce.date(), endDate: z.coerce.date(),
      termId: optStr(40), isHoliday: z.boolean().default(false), description: optStr(500),
    })
    .refine((v) => v.endDate >= v.startDate, { path: ["endDate"], message: "Must not be before the start" }),
  building: z.object({ code: code(10), name: z.string().trim().min(2).max(120), campusId: optStr(40) }),
  room: z.object({
    code: code(16), name: z.string().trim().min(1).max(120), buildingId: optStr(40), type: z.enum(RoomType),
    capacity: z.number().int().min(1).max(5000), examCapacity: z.number().int().min(0).max(5000).nullable().optional(), isActive: z.boolean().default(true),
  }),
} as const;
export type SetupKind = keyof typeof setupSchemas;

const PERM: Record<SetupKind, "academic.manage" | "enrollment.manage" | "timetable.manage"> = {
  batch: "academic.manage",
  term: "enrollment.manage",
  calendarEvent: "enrollment.manage",
  building: "timetable.manage",
  room: "timetable.manage",
};

/** Institution-wide setup records (not department-scoped): the permission must be held globally. */
function assertGlobal(ctx: AuthContext, kind: SetupKind) {
  if (!can(ctx, PERM[kind]) || ctx.grants.get(PERM[kind]) !== null) {
    throw forbidden(kind === "batch" ? "Only academic administrators can manage batches." : "Only institution-wide staff (e.g. the Registrar) can change this.");
  }
}

export async function saveSetup(ctx: AuthContext, kind: SetupKind, id: string | null, raw: unknown) {
  assertGlobal(ctx, kind);
  let saved: { id: string };
  switch (kind) {
    case "batch": {
      const v = setupSchemas.batch.parse(raw);
      if (v.curriculumId) {
        const c = await db.curriculum.findUnique({ where: { id: v.curriculumId } });
        if (!c || c.programId !== v.programId) throw invalid("The curriculum belongs to another programme.");
      }
      if (id) {
        const before = await db.batch.findUnique({ where: { id }, include: { _count: { select: { students: true } } } });
        if (!before) throw notFound("Batch");
        if (before._count.students && before.programId !== v.programId) throw invalid("A batch with students cannot move to another programme.");
      }
      saved = id ? await db.batch.update({ where: { id }, data: v }) : await db.batch.create({ data: v });
      break;
    }
    case "term": {
      const v = setupSchemas.term.parse(raw);
      const year = await db.academicYear.findUnique({ where: { id: v.academicYearId } });
      if (!year) throw invalid("Choose an academic year.");
      saved = await db.$transaction(async (tx) => {
        if (v.isCurrent) await tx.academicTerm.updateMany({ where: id ? { id: { not: id } } : {}, data: { isCurrent: false } });
        return id ? tx.academicTerm.update({ where: { id }, data: v }) : tx.academicTerm.create({ data: v });
      });
      break;
    }
    case "calendarEvent": {
      const v = setupSchemas.calendarEvent.parse(raw);
      saved = id ? await db.calendarEvent.update({ where: { id }, data: v }) : await db.calendarEvent.create({ data: v });
      break;
    }
    case "building": {
      const v = setupSchemas.building.parse(raw);
      saved = id ? await db.building.update({ where: { id }, data: v }) : await db.building.create({ data: v });
      break;
    }
    case "room": {
      const v = setupSchemas.room.parse(raw);
      saved = id ? await db.room.update({ where: { id }, data: { ...v, examCapacity: v.examCapacity ?? null } }) : await db.room.create({ data: { ...v, examCapacity: v.examCapacity ?? null } });
      break;
    }
  }
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: `${kind}.${id ? "update" : "create"}`, resourceType: kind, resourceId: saved.id, newValue: raw });
  return saved;
}

export async function deleteCalendarEvent(ctx: AuthContext, id: string) {
  assertGlobal(ctx, "calendarEvent");
  const e = await db.calendarEvent.findUnique({ where: { id } });
  if (!e) throw notFound("Calendar event");
  await db.calendarEvent.delete({ where: { id } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "calendarEvent.delete", resourceType: "calendarEvent", resourceId: id, summary: e.title, oldValue: e });
}

export async function currentTerm() {
  return (await db.academicTerm.findFirst({ where: { isCurrent: true } })) ?? db.academicTerm.findFirst({ where: { status: "IN_PROGRESS" }, orderBy: { startDate: "desc" } });
}

export async function assertTermEditable(termId: string) {
  const t = await db.academicTerm.findUnique({ where: { id: termId } });
  if (!t) throw notFound("Term");
  if (t.status === "COMPLETED") throw conflict("The term is completed; its classes can no longer be changed.");
  return t;
}
