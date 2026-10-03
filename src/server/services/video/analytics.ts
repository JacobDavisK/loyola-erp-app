import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { MEETING_TYPES, type MeetingType } from "@/lib/domain/video";
import { type AuthContext, can, isSuperAdmin, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, notFound } from "@/server/errors";
import { canViewAttendance } from "./attendance";
import { loadMeeting, meetingWhere } from "./access";

/**
 * Analytics. Aggregate figures are limited to the departments the viewer oversees (video.view_analytics);
 * lists of individual meetings additionally follow the normal visibility rules, so titles of restricted
 * meetings (viva, interviews, mentoring) never appear to someone outside them.
 */

function scopeWhere(ctx: AuthContext): Prisma.VideoMeetingWhereInput {
  if (isSuperAdmin(ctx)) return {};
  const scope = scopeOf(ctx, "video.view_analytics");
  if (scope === null) return {};
  return { departmentId: { in: scope } };
}

const hours = (ms: number) => Math.round((ms / 3_600_000) * 10) / 10;

export async function videoDashboard(ctx: AuthContext, now = new Date()) {
  if (!can(ctx, "video.view_analytics") && !isSuperAdmin(ctx)) throw forbidden();
  const where = scopeWhere(ctx);
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const yearAgo = new Date(now.getTime() - 365 * 86_400_000);
  const [total, today, active, upcoming, ended, recorded, presenceUsers, byType, byDept, recordingAgg, failed] = await Promise.all([
    db.videoMeeting.count({ where }),
    db.videoMeeting.count({ where: { ...where, scheduledStart: { gte: dayStart, lt: dayEnd }, status: { notIn: ["CANCELLED", "DRAFT"] } } }),
    db.videoMeeting.count({ where: { ...where, status: { in: ["LIVE", "STARTING"] } } }),
    db.videoMeeting.count({ where: { ...where, status: "SCHEDULED", scheduledStart: { gte: now } } }),
    db.videoMeeting.findMany({ where: { ...where, status: "ENDED", actualStart: { gte: yearAgo } }, select: { actualStart: true, actualEnd: true, meetingType: true, departmentId: true } }),
    db.videoMeeting.count({ where: { ...where, recordings: { some: { status: { in: ["AVAILABLE", "ARCHIVED"] } } } } }),
    db.videoPresence.findMany({ where: { meeting: where }, select: { participantId: true }, distinct: ["participantId"] }),
    db.videoMeeting.groupBy({ by: ["meetingType"], where, _count: true }),
    db.videoMeeting.groupBy({ by: ["departmentId"], where, _count: true }),
    db.videoMeetingRecording.aggregate({ where: { meeting: where, status: { in: ["AVAILABLE", "ARCHIVED"] } }, _count: true, _sum: { durationSeconds: true, fileSize: true } }),
    db.videoMeeting.findMany({ where: { AND: [where, meetingWhere(ctx), { status: "FAILED" }] }, orderBy: { updatedAt: "desc" }, take: 10, select: { id: true, publicId: true, title: true, failureReason: true, scheduledStart: true } }),
  ]);
  const totalHours = hours(ended.reduce((a, m) => a + ((m.actualEnd?.getTime() ?? 0) - (m.actualStart?.getTime() ?? 0)), 0));
  const months = new Map<string, number>();
  for (const m of ended) { const k = m.actualStart!.toISOString().slice(0, 7); months.set(k, (months.get(k) ?? 0) + 1); }
  const depts = new Map((await db.department.findMany({ where: { id: { in: byDept.map((d) => d.departmentId).filter((x): x is string => !!x) } }, select: { id: true, code: true } })).map((d) => [d.id, d.code]));
  const att = await db.videoMeetingAttendance.groupBy({ by: ["attendanceStatus"], where: { meeting: where }, _count: true, _avg: { attendancePercentage: true } });
  const visible = { AND: [where, meetingWhere(ctx)] };
  const [activeList, recent, recentRecordings] = await Promise.all([
    db.videoMeeting.findMany({ where: { ...visible, status: { in: ["LIVE", "STARTING"] } }, include: { host: { select: { name: true } }, _count: { select: { participants: { where: { connectionStatus: "CONNECTED" } } } } }, orderBy: { actualStart: "desc" }, take: 20 }),
    db.videoMeeting.findMany({ where: { ...visible, status: "ENDED" }, include: { host: { select: { name: true } }, _count: { select: { participants: true } } }, orderBy: { actualEnd: "desc" }, take: 15 }),
    db.videoMeetingRecording.findMany({ where: { deletedAt: null, meeting: visible }, include: { meeting: { select: { publicId: true, title: true } } }, orderBy: { startedAt: "desc" }, take: 10 }),
  ]);
  return {
    cards: { total, today, active, upcoming, recorded, participants: presenceUsers.length, hours: totalHours },
    byType: byType.map((t) => ({ label: MEETING_TYPES[t.meetingType as MeetingType].label, count: t._count })).sort((a, b) => b.count - a.count),
    byDepartment: byDept.map((d) => ({ label: d.departmentId ? depts.get(d.departmentId) ?? "—" : "Institution", count: d._count })).sort((a, b) => b.count - a.count),
    byMonth: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([label, count]) => ({ label, count })),
    attendance: att.map((a) => ({ status: a.attendanceStatus, count: a._count, avgPercent: Math.round((a._avg.attendancePercentage ?? 0) * 10) / 10 })),
    recordings: { count: recordingAgg._count, hours: hours((recordingAgg._sum.durationSeconds ?? 0) * 1000), gigabytes: Math.round((Number(recordingAgg._sum.fileSize ?? 0) / 1e9) * 100) / 100 },
    activeList, recent, failed, recentRecordings,
  };
}

/** One meeting's figures: duration, participation, peak, attendance, recordings. */
export async function meetingAnalytics(ctx: AuthContext, idOrPublicId: string) {
  const m = await loadMeeting(idOrPublicId);
  if (!canViewAttendance(ctx, m)) throw notFound("Meeting");
  const [presence, attendance, recordings] = await Promise.all([
    db.videoPresence.findMany({ where: { meetingId: m.id } }),
    db.videoMeetingAttendance.findMany({ where: { meetingId: m.id } }),
    db.videoMeetingRecording.findMany({ where: { meetingId: m.id, deletedAt: null } }),
  ]);
  // Peak: sweep over join (+1) and leave (−1) points, counting distinct participants.
  const end = m.actualEnd ?? new Date();
  const points = presence.flatMap((p) => [{ t: p.joinedAt.getTime(), d: 1, who: p.participantId }, { t: (p.leftAt ?? end).getTime(), d: -1, who: p.participantId }]).sort((a, b) => a.t - b.t || a.d - b.d);
  const live = new Map<string, number>();
  let peak = 0;
  for (const p of points) {
    live.set(p.who, (live.get(p.who) ?? 0) + p.d);
    peak = Math.max(peak, [...live.values()].filter((v) => v > 0).length);
  }
  const joined = new Set(presence.map((p) => p.participantId)).size;
  return {
    meeting: m,
    durationMinutes: m.actualStart ? Math.round(((m.actualEnd ?? new Date()).getTime() - m.actualStart.getTime()) / 60_000) : 0,
    invited: m.participants.filter((p) => p.role !== "HOST").length,
    joined,
    peak,
    averageAttendance: attendance.length ? Math.round((attendance.reduce((a, x) => a + x.attendancePercentage, 0) / attendance.length) * 10) / 10 : 0,
    present: attendance.filter((a) => a.attendanceStatus === "PRESENT").length,
    partial: attendance.filter((a) => a.attendanceStatus === "PARTIALLY_PRESENT").length,
    absent: attendance.filter((a) => a.attendanceStatus === "ABSENT").length,
    recordingMinutes: Math.round(recordings.reduce((a, r) => a + (r.durationSeconds ?? 0), 0) / 60),
  };
}

/** Meetings the viewer oversees, as CSV (for the analytics export). */
export async function meetingsCsv(ctx: AuthContext) {
  if (!can(ctx, "video.view_analytics") && !isSuperAdmin(ctx)) throw forbidden();
  const rows = await db.videoMeeting.findMany({ where: { AND: [scopeWhere(ctx), meetingWhere(ctx)] }, include: { host: { select: { name: true } }, department: { select: { code: true } }, _count: { select: { participants: true, recordings: true } }, attendance: { select: { attendancePercentage: true } } }, orderBy: { scheduledStart: "desc" }, take: 5000 });
  const cell = (v: unknown) => { let s = v === null || v === undefined ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  const head = ["Meeting ID", "Title", "Type", "Status", "Host", "Department", "Scheduled start", "Actual start", "Actual end", "Minutes", "Participants", "Average attendance %", "Recordings"];
  const lines = rows.map((m) => [
    m.publicId, m.title, MEETING_TYPES[m.meetingType as MeetingType].label, m.status, m.host.name, m.department?.code, m.scheduledStart.toISOString(), m.actualStart?.toISOString(), m.actualEnd?.toISOString(),
    m.actualStart && m.actualEnd ? Math.round((m.actualEnd.getTime() - m.actualStart.getTime()) / 60_000) : "", m._count.participants,
    m.attendance.length ? Math.round((m.attendance.reduce((a, x) => a + x.attendancePercentage, 0) / m.attendance.length) * 10) / 10 : "", m._count.recordings,
  ].map(cell).join(","));
  return [head.map(cell).join(","), ...lines].join("\r\n");
}
