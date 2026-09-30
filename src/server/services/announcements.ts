import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { reaches } from "@/lib/domain/campus";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, invalid, notFound } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { notify } from "@/server/services/notifications";

/**
 * Institution announcements for everyone, staff, students or guardians (students/guardians optionally narrowed
 * to a department or programme). Scheduled announcements are sent by the worker when they go live.
 */

export const announcementSchema = z.object({
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().min(3).max(10_000),
  audience: z.enum(["EVERYONE", "STAFF", "STUDENTS", "GUARDIANS"]),
  departmentId: z.string().nullable().optional().or(z.literal("")),
  programId: z.string().nullable().optional().or(z.literal("")),
  pinned: z.boolean().default(false),
  publishAt: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

async function recipients(a: { audience: string; departmentId: string | null; programId: string | null }) {
  const studentFilter: Prisma.StudentWhereInput = { deletedAt: null, status: "ACTIVE", ...(a.departmentId ? { departmentId: a.departmentId } : {}), ...(a.programId ? { programId: a.programId } : {}) };
  const ids = new Set<string>();
  if (a.audience === "EVERYONE" || a.audience === "STAFF") for (const u of await db.user.findMany({ where: { userType: "STAFF", status: "ACTIVE", deletedAt: null }, select: { id: true } })) ids.add(u.id);
  if (a.audience === "EVERYONE" || a.audience === "STUDENTS") for (const s of await db.student.findMany({ where: { ...studentFilter, userId: { not: null } }, select: { userId: true } })) ids.add(s.userId!);
  if (a.audience === "EVERYONE" || a.audience === "GUARDIANS") for (const g of await db.guardian.findMany({ where: { userId: { not: null }, student: studentFilter }, select: { userId: true } })) ids.add(g.userId!);
  return [...ids];
}

async function send(id: string) {
  const a = await db.announcement.findUniqueOrThrow({ where: { id } });
  const users = await recipients(a);
  // In-app for everyone; e-mail only for pinned (important) announcements.
  for (let i = 0; i < users.length; i += 500) await notify({ userIds: users.slice(i, i + 500), type: "announcement", title: a.title, body: a.body.slice(0, 240), link: "/announcements", email: a.pinned });
  await db.announcement.update({ where: { id }, data: { notified: true } });
  return users.length;
}

export async function publishAnnouncement(ctx: AuthContext, id: string | null, raw: unknown) {
  if (!can(ctx, "announcement.publish")) throw forbidden();
  const v = announcementSchema.parse(raw);
  const publishAt = v.publishAt ?? new Date();
  if (v.expiresAt && v.expiresAt <= publishAt) throw invalid("The expiry must be after publication.");
  if ((v.departmentId || v.programId) && (v.audience === "STAFF")) throw invalid("Department and programme narrowing applies to student and guardian audiences.");
  const data = { title: v.title, body: v.body, audience: v.audience, departmentId: v.departmentId || null, programId: v.programId || null, pinned: v.pinned, publishAt, expiresAt: v.expiresAt ?? null };
  const a = id ? await db.announcement.update({ where: { id }, data }) : await db.announcement.create({ data: { ...data, authorId: ctx.user.id } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: id ? "announcement.update" : "announcement.publish", resourceType: "announcement", resourceId: a.id, summary: `${a.audience}: ${a.title}` });
  if (!a.notified && a.publishAt <= new Date()) await send(a.id);
  return a;
}

export async function withdrawAnnouncement(ctx: AuthContext, id: string) {
  if (!can(ctx, "announcement.publish")) throw forbidden();
  const a = await db.announcement.findUnique({ where: { id } });
  if (!a) throw notFound("Announcement");
  await db.announcement.update({ where: { id }, data: { expiresAt: new Date(Math.max(Date.now(), a.publishAt.getTime() + 1000)) } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "announcement.withdraw", resourceType: "announcement", resourceId: id, summary: a.title });
}

/** Worker job: send scheduled announcements that have gone live. */
export async function dispatchDueAnnouncements(now = new Date()) {
  const due = await db.announcement.findMany({ where: { notified: false, publishAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, select: { id: true } });
  let n = 0;
  for (const a of due) n += await send(a.id);
  return n;
}

/** Live announcements the signed-in user is in the audience of. */
export async function visibleAnnouncements(ctx: AuthContext, take = 50) {
  const now = new Date();
  const live = await db.announcement.findMany({ where: { publishAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, orderBy: [{ pinned: "desc" }, { publishAt: "desc" }], take: 200, include: { author: { select: { name: true } } } });
  const ids = [...(ctx.subject.studentId ? [ctx.subject.studentId] : []), ...ctx.subject.wardStudentIds];
  const links = ids.length ? await db.student.findMany({ where: { id: { in: ids } }, select: { departmentId: true, programId: true } }) : [];
  const reader = { userType: ctx.user.userType as "STAFF" | "STUDENT" | "GUARDIAN", studentLinks: links };
  return live.filter((a) => reaches(a, reader)).slice(0, take);
}
