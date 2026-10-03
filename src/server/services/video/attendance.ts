import "server-only";
import { z } from "zod";
import { attendanceOf, presentSeconds } from "@/lib/domain/video";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { saveAttendance } from "@/server/services/attendance";
import { audit } from "@/server/services/audit";
import { getSetting } from "@/server/services/settings";
import { log } from "@/server/video/log";
import { hasOversight, isHostLike, loadMeeting, type MeetingWithParticipants } from "./access";

/**
 * Automatic attendance. It is computed only from connection intervals the server recorded from signed
 * OpenVidu webhooks (joins and leaves), clipped to when the meeting actually ran and merged so that
 * reconnects, two tabs or repeated events never count twice. Nothing the browser reports is used.
 * Corrections are possible, with a reason, by holders of video.modify_attendance — and are audited.
 */

export async function computeAttendance(meetingId: string) {
  const m = await db.videoMeeting.findUniqueOrThrow({ where: { id: meetingId }, include: { participants: true, presence: true } });
  if (!m.actualStart) return 0;
  const end = m.actualEnd ?? new Date();
  const meetingSeconds = Math.max(1, Math.round((end.getTime() - m.actualStart.getTime()) / 1000));
  const s = await getSetting("video");
  const rule = { presentPercent: s.attendancePresentPercent, partialMinMinutes: s.attendancePartialMinMinutes };
  const existing = new Map((await db.videoMeetingAttendance.findMany({ where: { meetingId } })).map((a) => [a.participantId, a]));
  let n = 0;
  for (const p of m.participants) {
    const prev = existing.get(p.id);
    if (prev?.manuallyAdjusted) continue;
    const intervals = m.presence.filter((x) => x.participantId === p.id);
    const seconds = presentSeconds(intervals, m.actualStart, end);
    const a = attendanceOf(seconds, meetingSeconds, rule);
    const firstJoinedAt = intervals.length ? new Date(Math.min(...intervals.map((i) => i.joinedAt.getTime()))) : null;
    const lefts = intervals.map((i) => i.leftAt?.getTime() ?? end.getTime());
    const data = { userId: p.userId, firstJoinedAt, lastLeftAt: lefts.length ? new Date(Math.max(...lefts)) : null, totalSeconds: seconds, attendancePercentage: a.percentage, attendanceStatus: a.status, computedAt: new Date() };
    await db.videoMeetingAttendance.upsert({ where: { participantId: p.id }, create: { meetingId, participantId: p.id, ...data }, update: data });
    n++;
  }
  log("info", "video.attendance_computed", { meeting: m.publicId, participants: n });
  return n;
}

export function canViewAttendance(ctx: AuthContext, m: MeetingWithParticipants) {
  return isHostLike(ctx, m) || (hasOversight(ctx, m) && can(ctx, "video.view_attendance", m.departmentId ?? undefined));
}

/** Attendance for a meeting: everyone's for hosts and oversight; only one's own otherwise. */
export async function meetingAttendance(ctx: AuthContext, idOrPublicId: string) {
  const m = await loadMeeting(idOrPublicId);
  const all = canViewAttendance(ctx, m);
  const mine = m.participants.find((p) => p.userId === ctx.user.id);
  if (!all && !mine) throw notFound("Meeting");
  const rows = await db.videoMeetingAttendance.findMany({ where: { meetingId: m.id, ...(all ? {} : { participantId: mine!.id }) }, orderBy: { totalSeconds: "desc" } });
  const names = new Map(m.participants.map((p) => [p.id, p]));
  return { meeting: m, canAdjust: can(ctx, "video.modify_attendance", m.departmentId ?? undefined) && (all || false), rows: rows.map((r) => ({ ...r, participant: names.get(r.participantId)! })) };
}

export async function adjustAttendance(ctx: AuthContext, attendanceId: string, raw: unknown) {
  const v = z.object({ status: z.enum(["PRESENT", "PARTIALLY_PRESENT", "ABSENT"]), reason: z.string().trim().min(5, "Give a reason (at least 5 characters).").max(500) }).parse(raw);
  const a = await db.videoMeetingAttendance.findUnique({ where: { id: attendanceId } });
  if (!a) throw notFound("Attendance");
  const m = await loadMeeting(a.meetingId);
  if (!can(ctx, "video.modify_attendance", m.departmentId ?? undefined) || !(isHostLike(ctx, m) || hasOversight(ctx, m))) throw forbidden("You cannot correct attendance for this meeting.");
  if (m.status !== "ENDED") throw workflowError("Attendance can be corrected after the meeting ends.");
  await db.videoMeetingAttendance.update({ where: { id: attendanceId }, data: { attendanceStatus: v.status, manuallyAdjusted: true, adjustedById: ctx.user.id, adjustmentReason: v.reason } });
  const who = m.participants.find((p) => p.id === a.participantId)?.displayName ?? "participant";
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "video.attendance.adjust", resourceType: "videoMeeting", resourceId: m.id, summary: `${m.publicId}: ${who} ${a.attendanceStatus} → ${v.status} (${v.reason})`, oldValue: { status: a.attendanceStatus, percentage: a.attendancePercentage }, newValue: { status: v.status } });
}

/**
 * Online class → the class register. The timetable's class session keeps a single attendance record;
 * this copies the measured video attendance into it through the normal attendance service (so its edit
 * windows and audit apply). PRESENT → present, PARTIALLY_PRESENT → late, ABSENT → absent.
 */
export async function applyToClassRegister(ctx: AuthContext, idOrPublicId: string) {
  const m = await loadMeeting(idOrPublicId);
  if (!m.classMeetingId) throw invalid("This meeting is not linked to a timetable class.");
  if (!isHostLike(ctx, m)) throw forbidden("Only the class's host can do this.");
  if (m.status !== "ENDED") throw workflowError("End the meeting first.");
  const att = await db.videoMeetingAttendance.findMany({ where: { meetingId: m.id } });
  const students = await db.student.findMany({ where: { userId: { in: att.map((a) => a.userId).filter((x): x is string => !!x) } }, select: { id: true, userId: true } });
  const byUser = new Map(students.map((s) => [s.userId!, s.id]));
  const marks = att.filter((a) => a.userId && byUser.has(a.userId)).map((a) => ({
    studentId: byUser.get(a.userId!)!,
    mark: a.attendanceStatus === "PRESENT" ? ("PRESENT" as const) : a.attendanceStatus === "PARTIALLY_PRESENT" ? ("LATE" as const) : ("ABSENT" as const),
    remarks: `Online: ${Math.round(a.totalSeconds / 60)} min (${a.attendancePercentage}%)`,
  }));
  if (!marks.length) throw workflowError("No registered students took part.");
  await saveAttendance(ctx, m.classMeetingId, { topic: `Online class ${m.publicId}`, marks });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "video.attendance.register", resourceType: "videoMeeting", resourceId: m.id, summary: `${m.publicId}: ${marks.length} student(s) copied to the class register` });
  return marks.length;
}

export function attendanceCsv(rows: { participant: { displayName: string; role: string; panelRole: string | null }; totalSeconds: number; attendancePercentage: number; attendanceStatus: string; firstJoinedAt: Date | null; lastLeftAt: Date | null; manuallyAdjusted: boolean; adjustmentReason: string | null }[]) {
  // Cells are quoted and formula-like prefixes neutralised (CSV injection).
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const head = ["Name", "Role", "Panel role", "Minutes", "Attendance %", "Status", "First joined", "Last left", "Corrected", "Reason"];
  const lines = rows.map((r) => [r.participant.displayName, r.participant.role, r.participant.panelRole, Math.round(r.totalSeconds / 60), r.attendancePercentage, r.attendanceStatus, r.firstJoinedAt?.toISOString(), r.lastLeftAt?.toISOString(), r.manuallyAdjusted ? "yes" : "", r.adjustmentReason].map(cell).join(","));
  return [head.map(cell).join(","), ...lines].join("\r\n");
}
