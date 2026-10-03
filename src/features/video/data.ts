import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { MEETING_TYPES, type MeetingType } from "@/lib/domain/video";
import { type AuthContext, can, isSuperAdmin } from "@/server/auth/current";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { getInstitution } from "@/server/services/directory";
import { getSetting } from "@/server/services/settings";
import { meetingWhere } from "@/server/services/video/access";

export const cardInclude = {
  host: { select: { name: true } },
  offering: { select: { section: true, course: { select: { code: true, title: true } } } },
  department: { select: { code: true } },
  participants: { select: { userId: true, role: true, invitationStatus: true, connectionStatus: true } },
  _count: { select: { participants: true, recordings: { where: { status: { in: ["AVAILABLE" as const, "ARCHIVED" as const] } } } } },
} satisfies Prisma.VideoMeetingInclude;

export type MeetingCardRow = Prisma.VideoMeetingGetPayload<{ include: typeof cardInclude }>;

/** Meetings for one of the list views, already filtered by what the person may see. */
export async function meetingList(ctx: AuthContext, view: "today" | "upcoming" | "past" | "cancelled" | "drafts", extra: Prisma.VideoMeetingWhereInput = {}, take = 60) {
  const now = new Date();
  const { timezone } = await getInstitution();
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const { zonedTimeToUtc } = await import("@/lib/domain/timetable");
  const dayStart = zonedTimeToUtc(ymd, "00:00", timezone);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const where: Prisma.VideoMeetingWhereInput =
    view === "today" ? { scheduledStart: { gte: dayStart, lt: dayEnd }, status: { notIn: ["CANCELLED", "DRAFT"] } }
    : view === "upcoming" ? { OR: [{ status: { in: ["LIVE", "STARTING"] } }, { status: { in: ["SCHEDULED", "FAILED"] }, scheduledEnd: { gte: now } }] }
    : view === "past" ? { OR: [{ status: "ENDED" }, { status: { in: ["SCHEDULED", "FAILED"] }, scheduledEnd: { lt: now } }] }
    : view === "cancelled" ? { status: "CANCELLED" }
    : { status: "DRAFT", hostUserId: ctx.user.id };
  return db.videoMeeting.findMany({ where: { AND: [meetingWhere(ctx), where, extra] }, include: cardInclude, orderBy: { scheduledStart: view === "past" || view === "cancelled" ? "desc" : "asc" }, take });
}

/** Options for the scheduler: enabled meeting types, my classes, my mentees, departments. */
export async function schedulerOptions(ctx: AuthContext) {
  const [s, inst] = await Promise.all([getSetting("video"), getInstitution()]);
  const types = (Object.keys(MEETING_TYPES) as MeetingType[]).filter((t) => s.enabledTypes.includes(t)).map((t) => ({ id: t, label: MEETING_TYPES[t].label }));
  const [offerings, mentees, departments] = await Promise.all([
    db.courseOffering.findMany({ where: { status: { in: ["OPEN", "PLANNED"] }, ...(isSuperAdmin(ctx) ? {} : { instructors: { some: { userId: ctx.user.id } } }) }, include: { course: { select: { code: true, title: true } }, term: { select: { name: true } } }, orderBy: { course: { code: "asc" } }, take: 200 }),
    db.mentorAssignment.findMany({ where: { mentorId: ctx.user.id, endsOn: null }, include: { student: { select: { id: true, firstName: true, lastName: true, studentNo: true } } }, take: 200 }),
    db.department.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);
  return {
    types,
    offerings: offerings.map((o) => ({ id: o.id, label: `${o.course.code}-${o.section} ${o.course.title} (${o.term.name})` })),
    mentees: mentees.map((m) => ({ id: m.student.id, label: `${m.student.firstName} ${m.student.lastName} (${m.student.studentNo})` })),
    departments: departments.map((d) => ({ id: d.id, label: `${d.code} — ${d.name}` })),
    recordingAvailable: s.recordingEnabled && env.OPENVIDU_RECORDING_ENABLED === "true",
    defaults: s,
    timezone: inst.timezone,
  };
}

export const canSchedule = (ctx: AuthContext) => can(ctx, "video.schedule") || can(ctx, "video.create");
