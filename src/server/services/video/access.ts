import "server-only";
import type { Prisma, VideoMeeting, VideoMeetingParticipant } from "@/generated/prisma/client";
import { MEETING_TYPES, PUBLIC_ID, type MeetingType } from "@/lib/domain/video";
import { type AuthContext, can, isSuperAdmin, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, notFound } from "@/server/errors";
import { log } from "@/server/video/log";

/**
 * Who may see, join, host and moderate a meeting. Every page, API route, list and search goes through
 * these rules; nothing the browser sends (ids, roles, attendance) is trusted on its own.
 *
 * - Participants (invited, not removed) and the host always see their meetings.
 * - Visibility widens discovery: COURSE (the class's instructors and registered students), DEPARTMENT
 *   (its staff and students), INSTITUTION (any staff or student account).
 * - Oversight (heads and administrators with video analytics rights in the department) may view
 *   meetings and their records — but never restricted kinds (viva, PhD review, mentoring, interviews,
 *   parent and examination meetings), which only their participants and the Super Admin can open.
 */

const ACTIVE_REG: ("REGISTERED" | "COMPLETED")[] = ["REGISTERED", "COMPLETED"];

export const NO_ACCESS = "Your account does not have permission to join this meeting.";

export const isRestricted = (t: string) => MEETING_TYPES[t as MeetingType]?.restricted ?? true;

export async function loadMeeting(idOrPublicId: string) {
  const key = String(idOrPublicId ?? "").slice(0, 60);
  const m = await db.videoMeeting.findUnique({ where: PUBLIC_ID.test(key) ? { publicId: key } : { id: key }, include: { participants: true } });
  if (!m) throw notFound("Meeting");
  return m;
}

export type MeetingWithParticipants = VideoMeeting & { participants: VideoMeetingParticipant[] };

export const myParticipant = (ctx: AuthContext, m: MeetingWithParticipants) => m.participants.find((p) => p.userId === ctx.user.id) ?? null;

export function isHostLike(ctx: AuthContext, m: MeetingWithParticipants): boolean {
  if (m.hostUserId === ctx.user.id || isSuperAdmin(ctx)) return true;
  const p = myParticipant(ctx, m);
  return !!p && p.connectionStatus !== "REMOVED" && p.role === "CO_HOST";
}

export function isModerator(ctx: AuthContext, m: MeetingWithParticipants): boolean {
  if (isHostLike(ctx, m)) return true;
  const p = myParticipant(ctx, m);
  return !!p && p.connectionStatus !== "REMOVED" && p.role === "MODERATOR";
}

export function hasOversight(ctx: AuthContext, m: Pick<VideoMeeting, "meetingType" | "departmentId">): boolean {
  if (isSuperAdmin(ctx)) return true;
  if (isRestricted(m.meetingType)) return false;
  return m.departmentId ? can(ctx, "video.view_analytics", m.departmentId) : scopeOf(ctx, "video.view_analytics") === null;
}

/** Whether the caller belongs to the meeting's audience through its visibility setting. */
async function inAudience(ctx: AuthContext, m: VideoMeeting): Promise<boolean> {
  if (isRestricted(m.meetingType) || m.visibility === "INVITED") return false;
  if (ctx.user.userType === "GUARDIAN" || ctx.user.userType === "EXTERNAL") return false;
  if (m.visibility === "INSTITUTION") return true;
  if (m.visibility === "COURSE" && m.offeringId) {
    const hit = await db.courseOffering.count({
      where: { id: m.offeringId, OR: [{ instructors: { some: { userId: ctx.user.id } } }, ...(ctx.subject.studentId ? [{ registrations: { some: { studentId: ctx.subject.studentId, status: { in: ACTIVE_REG } } } }] : [])] },
    });
    return hit > 0;
  }
  if (m.visibility === "DEPARTMENT" && m.departmentId) {
    if (ctx.user.departmentId === m.departmentId) return true;
    if (ctx.subject.studentId) return (await db.student.count({ where: { id: ctx.subject.studentId, departmentId: m.departmentId } })) > 0;
  }
  return false;
}

export async function canSee(ctx: AuthContext, m: MeetingWithParticipants): Promise<boolean> {
  if (m.hostUserId === ctx.user.id || isSuperAdmin(ctx)) return true;
  const p = myParticipant(ctx, m);
  if (p && p.connectionStatus !== "REMOVED") return true;
  if (p?.connectionStatus === "REMOVED") return false;
  if (m.status === "DRAFT") return false;
  return hasOversight(ctx, m) || (await inAudience(ctx, m));
}

/** May the caller join the room (as opposed to only viewing its record)? */
export async function canJoin(ctx: AuthContext, m: MeetingWithParticipants): Promise<boolean> {
  if (!can(ctx, "video.join") && m.hostUserId !== ctx.user.id) return false;
  const p = myParticipant(ctx, m);
  if (p?.connectionStatus === "REMOVED") return false;
  if (m.hostUserId === ctx.user.id || p || isSuperAdmin(ctx)) return true;
  return inAudience(ctx, m);
}

export async function assertSee(ctx: AuthContext, m: MeetingWithParticipants) {
  if (!(await canSee(ctx, m))) {
    log("warn", "video.access_denied", { userId: ctx.user.id, meeting: m.publicId, action: "view" });
    throw notFound("Meeting"); // indistinguishable from a meeting that does not exist
  }
}

export function assertHost(ctx: AuthContext, m: MeetingWithParticipants, message = "Only the host or a co-host can do that.") {
  if (!isHostLike(ctx, m)) {
    log("warn", "video.access_denied", { userId: ctx.user.id, meeting: m.publicId, action: "host" });
    throw forbidden(message);
  }
}

/** Prisma filter for lists and search: the same rules as canSee, expressed as a query. */
export function meetingWhere(ctx: AuthContext): Prisma.VideoMeetingWhereInput {
  if (isSuperAdmin(ctx)) return {};
  const or: Prisma.VideoMeetingWhereInput[] = [
    { hostUserId: ctx.user.id },
    { participants: { some: { userId: ctx.user.id, connectionStatus: { not: "REMOVED" } } } },
  ];
  const notRestricted: Prisma.VideoMeetingWhereInput = { meetingType: { in: (Object.keys(MEETING_TYPES) as MeetingType[]).filter((t) => !MEETING_TYPES[t].restricted) }, status: { not: "DRAFT" } };
  const notRemoved: Prisma.VideoMeetingWhereInput = { NOT: { participants: { some: { userId: ctx.user.id, connectionStatus: "REMOVED" } } } };
  if (ctx.user.userType === "STAFF" || ctx.user.userType === "STUDENT") {
    or.push({ AND: [notRestricted, notRemoved, { visibility: "INSTITUTION" }] });
    or.push({ AND: [notRestricted, notRemoved, { visibility: "COURSE" }, { offering: { OR: [{ instructors: { some: { userId: ctx.user.id } } }, ...(ctx.subject.studentId ? [{ registrations: { some: { studentId: ctx.subject.studentId, status: { in: ACTIVE_REG } } } }] : [])] } }] });
    if (ctx.user.departmentId) or.push({ AND: [notRestricted, notRemoved, { visibility: "DEPARTMENT", departmentId: ctx.user.departmentId }] });
  }
  const scope = scopeOf(ctx, "video.view_analytics");
  if (scope === null) or.push(notRestricted);
  else if (scope.length) or.push({ AND: [notRestricted, { departmentId: { in: scope } }] });
  return { OR: or };
}
