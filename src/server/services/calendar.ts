import "server-only";
import { type CalendarEvent, buildIcs } from "@/lib/domain/integrations";
import { offeringWhere } from "@/server/auth/access";
import { type AuthContext, buildAuthContext } from "@/server/auth/current";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { randomToken, sha256 } from "@/server/security/crypto";
import { audit } from "@/server/services/audit";

/**
 * Private calendar subscription. Each person can create a secret link that Google Calendar, Outlook or a
 * phone's calendar subscribes to: classes, examinations, assignment deadlines, registered events and room
 * bookings. The link is shown once (only a hash is kept) and can be replaced, which cuts off the old one.
 */

export async function createFeed(ctx: AuthContext) {
  const token = randomToken(32);
  await db.calendarFeed.upsert({ where: { userId: ctx.user.id }, create: { userId: ctx.user.id, tokenHash: sha256(token) }, update: { tokenHash: sha256(token), createdAt: new Date() } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "calendar.feed.create", resourceType: "user", resourceId: ctx.user.id, summary: "Calendar subscription link created" });
  return `${env.APP_URL}/api/calendar/${token}.ics`;
}

export async function deleteFeed(ctx: AuthContext) {
  await db.calendarFeed.deleteMany({ where: { userId: ctx.user.id } });
}

export async function calendarFor(ctx: AuthContext, now = new Date()): Promise<CalendarEvent[]> {
  const from = new Date(now.getTime() - 14 * 86_400_000);
  const to = new Date(now.getTime() + 120 * 86_400_000);
  const self = ctx.subject.studentId;
  const [classes, exams, assignments, events, bookings] = await Promise.all([
    db.classMeeting.findMany({ where: { status: { not: "CANCELLED" }, startsAt: { gte: from, lt: to }, offering: offeringWhere(ctx) }, include: { offering: { include: { course: { select: { code: true, title: true } } } }, room: { select: { code: true, name: true } } }, take: 2000 }),
    self ? db.examRegistration.findMany({ where: { studentId: self, examination: { schedule: { startsAt: { gte: from, lt: to } } } }, include: { examination: { include: { course: { select: { code: true, title: true } }, schedule: true } } } }) : [],
    self ? db.assignment.findMany({ where: { publishedAt: { not: null }, dueAt: { gte: from, lt: to }, offering: { registrations: { some: { studentId: self, status: { in: ["REGISTERED", "COMPLETED"] } } } } }, include: { offering: { include: { course: { select: { code: true } } } } } }) : [],
    db.eventRegistration.findMany({ where: { userId: ctx.user.id, event: { status: { in: ["PUBLISHED", "COMPLETED"] }, startsAt: { gte: from, lt: to } } }, include: { event: true } }),
    db.facilityBooking.findMany({ where: { bookedById: ctx.user.id, status: "APPROVED", startsAt: { gte: from, lt: to } }, include: { room: { select: { code: true, name: true } } } }),
  ]);
  return [
    ...classes.map((m) => ({ uid: `class-${m.id}@erp`, title: `${m.offering.course.code} ${m.offering.course.title}`, startsAt: m.startsAt, endsAt: m.endsAt, location: m.room ? `${m.room.code} ${m.room.name}` : null })),
    ...exams.filter((r) => r.examination.schedule).map((r) => ({ uid: `exam-${r.id}@erp`, title: `Examination: ${r.examination.course.code} ${r.examination.course.title}`, startsAt: r.examination.schedule!.startsAt, endsAt: r.examination.schedule!.endsAt, location: r.examination.schedule!.venue, description: r.hallTicketNo ? `Hall ticket ${r.hallTicketNo}` : null })),
    ...assignments.map((a) => ({ uid: `assignment-${a.id}@erp`, title: `Due: ${a.offering.course.code} — ${a.title}`, startsAt: new Date(a.dueAt.getTime() - 30 * 60_000), endsAt: a.dueAt })),
    ...events.map((r) => ({ uid: `event-${r.event.id}@erp`, title: r.event.title, startsAt: r.event.startsAt, endsAt: r.event.endsAt, location: r.event.venue })),
    ...bookings.map((b) => ({ uid: `booking-${b.id}@erp`, title: `${b.title} (room booked)`, startsAt: b.startsAt, endsAt: b.endsAt, location: `${b.room.code} ${b.room.name}` })),
  ];
}

/** The feed for a secret token, or null. */
export async function feedByToken(token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) return null;
  const f = await db.calendarFeed.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { select: { status: true, deletedAt: true, name: true } } } });
  if (!f || f.user.status !== "ACTIVE" || f.user.deletedAt) return null;
  const ctx = await buildAuthContext(f.userId, `calendar:${f.id}`);
  if (!ctx) return null;
  return buildIcs(`Loyola University — ${f.user.name}`, await calendarFor(ctx));
}
