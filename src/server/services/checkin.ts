import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { z } from "zod";
import { locationCheck, QR_STEP_SECONDS, qrStep } from "@/lib/domain/teaching";
import { canTakeAttendance } from "@/server/auth/access";
import { type AuthContext } from "@/server/auth/current";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { safeEqual, sha256 } from "@/server/security/crypto";
import { audit } from "@/server/services/audit";

/**
 * QR self check-in. The teacher opens check-in for a class meeting and shows a QR code that changes every
 * 20 seconds; students scan it with their phone (signed in to the portal). A scan is accepted when:
 *  - the code is the current or previous one (a photo forwarded a minute later no longer works),
 *  - the window is open and the student is registered in the class,
 *  - optionally, the phone's location is within the set radius of the classroom,
 *  - the phone has not already checked in another student (one device, one student).
 * The check-in becomes a normal attendance mark (present, or late after the set minutes) that the
 * teacher can still correct. Face recognition is deliberately not used: it is biometric data under the
 * DPDP Act and needs separate consent and safeguards.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });

async function meetingForTeacher(ctx: AuthContext, meetingId: string) {
  const m = await db.classMeeting.findUnique({ where: { id: meetingId }, include: { offering: { include: { course: { select: { code: true, departmentId: true } }, instructors: { select: { userId: true } } } }, checkIn: true } });
  if (!m) throw notFound("Class meeting");
  if (!canTakeAttendance(ctx, { courseDepartmentId: m.offering.course.departmentId, instructorIds: m.offering.instructors.map((i) => i.userId) })) throw forbidden();
  return m;
}

const tokenFor = (secret: string, step: number) => createHmac("sha256", `${env.APP_SECRET}:${secret}`).update(String(step)).digest("base64url").slice(0, 16);

export async function openCheckIn(ctx: AuthContext, meetingId: string, raw: unknown) {
  const m = await meetingForTeacher(ctx, meetingId);
  const v = z.object({
    minutes: z.number().int().min(2).max(90),
    lateAfterMinutes: z.number().int().min(0).max(90),
    requireLocation: z.boolean(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    radiusMeters: z.number().int().min(10).max(5000).nullable().optional(),
  }).parse(raw);
  if (m.status === "CANCELLED") throw workflowError("The class was cancelled.");
  if (v.requireLocation && (v.latitude == null || v.longitude == null || !v.radiusMeters)) throw invalid("Allow location access on this device, so students' locations can be compared with the classroom.");
  const now = new Date();
  const data = { openedById: ctx.user.id, opensAt: now, closesAt: new Date(now.getTime() + v.minutes * 60_000), lateAfterMinutes: v.lateAfterMinutes, requireLocation: v.requireLocation, latitude: v.requireLocation ? v.latitude! : null, longitude: v.requireLocation ? v.longitude! : null, radiusMeters: v.requireLocation ? v.radiusMeters! : null };
  const w = m.checkIn
    ? await db.checkInWindow.update({ where: { id: m.checkIn.id }, data })
    : await db.checkInWindow.create({ data: { ...data, meetingId, secret: randomBytes(24).toString("base64url") } });
  await audit({ ...actor(ctx), action: "attendance.checkin.open", resourceType: "classMeeting", resourceId: meetingId, summary: `${m.offering.course.code}-${m.offering.section}: ${v.minutes} min${v.requireLocation ? `, within ${v.radiusMeters} m` : ""}` });
  return w;
}

export async function closeCheckIn(ctx: AuthContext, meetingId: string) {
  const m = await meetingForTeacher(ctx, meetingId);
  if (!m.checkIn) throw notFound("Check-in");
  await db.checkInWindow.update({ where: { id: m.checkIn.id }, data: { closesAt: new Date() } });
}

/** The current QR code for the teacher's screen (and how many students have checked in). */
export async function currentQr(ctx: AuthContext, meetingId: string) {
  const m = await meetingForTeacher(ctx, meetingId);
  const w = m.checkIn;
  if (!w || w.closesAt <= new Date()) return { open: false as const };
  const step = qrStep(Date.now());
  const url = `${env.APP_URL}/checkin/${w.id}?t=${tokenFor(w.secret, step)}`;
  const [svg, count, registered] = await Promise.all([
    QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }),
    db.checkIn.count({ where: { windowId: w.id } }),
    db.courseRegistration.count({ where: { offeringId: m.offeringId, status: "REGISTERED" } }),
  ]);
  return { open: true as const, svg, url, count, registered, closesAt: w.closesAt.toISOString(), refreshInMs: (QR_STEP_SECONDS - ((Date.now() / 1000) % QR_STEP_SECONDS)) * 1000 };
}

const scanSchema = z.object({
  token: z.string().min(8).max(64),
  deviceId: z.string().min(16).max(128),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  accuracy: z.number().min(0).max(100_000).nullable().optional(),
});

export async function checkIn(ctx: AuthContext, windowId: string, raw: unknown) {
  const studentId = ctx.subject.studentId;
  if (!studentId) throw forbidden("Sign in with your student account to check in.");
  const v = scanSchema.parse(raw);
  const w = await db.checkInWindow.findUnique({ where: { id: windowId }, include: { meeting: { select: { id: true, offeringId: true, startsAt: true, status: true, offering: { select: { course: { select: { code: true } } } } } } } });
  if (!w) throw notFound("Check-in");
  const now = new Date();
  if (now < w.opensAt || now > w.closesAt) throw workflowError("Check-in for this class is closed.");
  const step = qrStep(now.getTime());
  if (![step, step - 1].some((s) => safeEqual(tokenFor(w.secret, s), v.token))) throw workflowError("This QR code has expired. Scan the code on the screen again.");
  const reg = await db.courseRegistration.findFirst({ where: { offeringId: w.meeting.offeringId, studentId, status: "REGISTERED" } });
  if (!reg) throw forbidden("You are not registered in this class.");
  let distance: number | null = null;
  if (w.requireLocation) {
    if (v.latitude == null || v.longitude == null || v.accuracy == null) throw invalid("This class needs your location to check in. Allow location access and try again.");
    const r = locationCheck({ lat: v.latitude, lng: v.longitude, accuracy: v.accuracy }, { lat: w.latitude!, lng: w.longitude!, radius: w.radiusMeters! });
    if (!r.ok) throw workflowError(r.reason!);
    distance = r.distance;
  }
  const deviceHash = sha256(`${env.APP_SECRET}:device:${v.deviceId}`);
  const late = now.getTime() > w.meeting.startsAt.getTime() + w.lateAfterMinutes * 60_000;
  try {
    await db.$transaction(async (tx) => {
      await tx.checkIn.create({ data: { windowId, studentId, deviceHash, latitude: v.latitude ?? null, longitude: v.longitude ?? null, accuracy: v.accuracy ?? null, distanceM: distance, late } });
      await tx.attendanceRecord.upsert({
        where: { meetingId_studentId: { meetingId: w.meeting.id, studentId } },
        create: { meetingId: w.meeting.id, studentId, mark: late ? "LATE" : "PRESENT", remarks: "QR check-in", markedById: w.openedById },
        update: { mark: late ? "LATE" : "PRESENT", remarks: "QR check-in", markedById: w.openedById },
      });
      if (w.meeting.status === "SCHEDULED") await tx.classMeeting.update({ where: { id: w.meeting.id }, data: { status: "HELD", takenById: w.openedById, takenAt: now } });
    });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") {
      const mine = await db.checkIn.findUnique({ where: { windowId_studentId: { windowId, studentId } } });
      throw conflict(mine ? "You have already checked in to this class." : "This phone has already been used to check in another student. Use your own phone.");
    }
    throw e;
  }
  return { course: w.meeting.offering.course.code, late };
}
