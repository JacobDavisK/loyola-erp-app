/**
 * Video & collaboration demo data: an upcoming online class for a real class (whole roll invited), an upcoming
 * department meeting, and a held faculty meeting with automatic attendance. No media is involved — meetings only
 * start when an OpenVidu server is configured.
 */
import { randomBytes } from "node:crypto";
import { MEETING_TYPES, type MeetingType } from "../src/lib/domain/video";
import type { SeedContext } from "./seed-erp";

export async function seedVideo(s: SeedContext) {
  const { db } = s;
  console.log("› video: online class, department meeting, held faculty meeting");
  const inst = await db.institution.findFirst({ select: { timezone: true } });
  const timezone = inst?.timezone ?? "Asia/Kolkata";
  const offering = await db.courseOffering.findFirst({
    where: { status: "OPEN", instructors: { some: { isPrimary: true } }, registrations: { some: { status: "REGISTERED" } } },
    include: { course: true, instructors: { where: { isPrimary: true }, include: { user: true } }, registrations: { where: { status: "REGISTERED" }, include: { student: { include: { user: true } } } } },
  });
  if (!offering) return;
  const host = offering.instructors[0].user;
  const colleagues = await db.user.findMany({ where: { id: { not: host.id }, userType: "STAFF", deletedAt: null, status: "ACTIVE", departmentId: offering.course.departmentId }, take: 4 });

  const publicId = async (type: MeetingType, at: Date) => {
    const code = MEETING_TYPES[type].code;
    const rows = await db.$queryRaw<{ value: number }[]>`
      INSERT INTO "NumberSequence" ("key", "prefix", "next", "padding", "updatedAt")
      VALUES (${`video.${code}`}, ${`ERP-${code}-{YYYY}-`}, 2, 6, now())
      ON CONFLICT ("key") DO UPDATE SET "next" = "NumberSequence"."next" + 1, "updatedAt" = now()
      RETURNING "next" - 1 AS value`;
    return `ERP-${code}-${at.getFullYear()}-${String(Number(rows[0].value)).padStart(6, "0")}`;
  };
  const hour = 3_600_000;
  const slot = (daysAhead: number, utcHour: number) => { const d = new Date(s.now.getTime() + daysAhead * 86_400_000); d.setUTCHours(utcHour, 0, 0, 0); return d; };
  type P = { userId: string; displayName: string; role?: "HOST" | "CO_HOST" | "PARTICIPANT" };
  const create = async (type: MeetingType, title: string, start: Date, minutes: number, people: P[], extra: Record<string, unknown> = {}) =>
    db.videoMeeting.create({
      data: {
        publicId: await publicId(type, start), title, meetingType: type, hostUserId: host.id, departmentId: offering.course.departmentId,
        scheduledStart: start, scheduledEnd: new Date(start.getTime() + minutes * 60_000), timezone, participantLimit: 300,
        roomName: `erp_${randomBytes(12).toString("hex")}`, createdById: host.id, lobbyEnabled: MEETING_TYPES[type].lobby,
        ...extra,
        participants: { create: [{ userId: host.id, displayName: host.name, role: "HOST", invitationStatus: "ACCEPTED" }, ...people.map((p) => ({ userId: p.userId, displayName: p.displayName, role: p.role ?? "PARTICIPANT" }))] },
      },
    });

  const roll = offering.registrations.filter((r) => r.student.user).map((r) => ({ userId: r.student.user!.id, displayName: `${r.student.firstName} ${r.student.lastName}` }));
  await create("ONLINE_CLASS", `${offering.course.code} ${offering.course.title} — Section ${offering.section}`, slot(1, 4), 60, roll, { offeringId: offering.id, courseId: offering.courseId, visibility: "COURSE", recordingAccess: "COURSE", description: "Revision before the first internal test." });
  const staff = colleagues.map((c) => ({ userId: c.id, displayName: c.name }));
  await create("DEPARTMENT_MEETING", "Department meeting — internal assessment schedule", slot(3, 9), 45, staff, { description: "Agenda: CAT I dates, question-paper deadlines, lab allotment." });

  // A held meeting: 45 minutes, with attendance computed the way the webhook path would.
  const start = new Date(slot(-2, 10).getTime());
  const held = await create("FACULTY_MEETING", "Faculty meeting — curriculum review", start, 45, staff, { status: "ENDED", actualStart: start, actualEnd: new Date(start.getTime() + 0.75 * hour) });
  const parts = await db.videoMeetingParticipant.findMany({ where: { meetingId: held.id } });
  const total = 45 * 60;
  for (const [i, p] of parts.entries()) {
    const seconds = i === parts.length - 1 ? 0 : i === parts.length - 2 ? 12 * 60 : total - i * 60;
    const pct = Math.round((seconds / total) * 10_000) / 100;
    await db.videoMeetingParticipant.update({ where: { id: p.id }, data: { invitationStatus: "ACCEPTED", connectionStatus: seconds ? "DISCONNECTED" : "INVITED", lastJoinedAt: seconds ? start : null } });
    if (seconds) await db.videoPresence.create({ data: { meetingId: held.id, participantId: p.id, connectionSid: `PA_seed${randomBytes(6).toString("hex")}`, joinedAt: start, leftAt: new Date(start.getTime() + seconds * 1000) } });
    await db.videoMeetingAttendance.create({
      data: {
        meetingId: held.id, participantId: p.id, userId: p.userId, totalSeconds: seconds, attendancePercentage: pct,
        firstJoinedAt: seconds ? start : null, lastLeftAt: seconds ? new Date(start.getTime() + seconds * 1000) : null,
        attendanceStatus: !seconds ? "ABSENT" : pct >= 75 ? "PRESENT" : "PARTIALLY_PRESENT",
      },
    });
  }
}
