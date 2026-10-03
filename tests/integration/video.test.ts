import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ "user-agent": "vitest" }),
}));

import { db } from "@/server/db";
import { setVideoProvider } from "@/server/video/provider";
import { adjustAttendance, computeAttendance, meetingAttendance } from "@/server/services/video/attendance";
import { meetingWhere } from "@/server/services/video/access";
import { chatHistory, postChat } from "@/server/services/video/chat";
import {
  addMeetingNote, addParticipants, cancelMeeting, createGuestInvite, createMeeting, decideLobby, endMeeting, instantMeeting, joinAsGuest, joinMeeting, meetingNotes, removeParticipant, revokeGuest, setParticipantRole, startMeeting,
} from "@/server/services/video/meetings";
import { canWatch, playbackUrl, startRecording, updateRecording, verifyPlayback } from "@/server/services/video/recordings";
import { processVideoEvent, receiveVideoWebhook } from "@/server/services/video/webhooks";
import { FakeVideoProvider } from "../support/fake-video-provider";
import { as } from "./helpers";

const fake = new FakeVideoProvider();
beforeAll(() => setVideoProvider(fake));
afterAll(() => setVideoProvider(null));

const MIN = 60_000;
let seq = 0;
const ev = (type: string, room: string, extra: Record<string, unknown> = {}) => ({ id: `EV_${Date.now()}_${++seq}`, type, at: new Date(), room, ...extra });

async function bcs304() {
  const f = await db.user.findUniqueOrThrow({ where: { email: "faculty.cs1@example.edu" } });
  return db.courseOffering.findFirstOrThrow({ where: { instructors: { some: { userId: f.id } }, status: "OPEN", course: { code: "BCS304" } } });
}

describe("scheduling and access control", () => {
  it("schedules an online class for the whole class roll and refuses outsiders", async () => {
    const faculty = await as("faculty.cs1");
    const offering = await bcs304();
    const start = new Date(Date.now() - MIN);
    await expect(createMeeting(await as("student"), { title: "Nope", meetingType: "GENERAL_MEETING", scheduledStart: start, scheduledEnd: new Date(start.getTime() + 60 * MIN) })).rejects.toThrow(/cannot schedule/);
    await expect(createMeeting(await as("faculty.com1"), { title: "Not my class", meetingType: "ONLINE_CLASS", offeringId: offering.id, scheduledStart: start, scheduledEnd: new Date(start.getTime() + 60 * MIN) })).rejects.toThrow(/teachers/);

    const m = await createMeeting(faculty, { title: "Data structures — live", meetingType: "ONLINE_CLASS", offeringId: offering.id, scheduledStart: start, scheduledEnd: new Date(start.getTime() + 60 * MIN), recordingEnabled: true });
    expect(m.publicId).toMatch(/^ERP-ACD-\d{4}-\d{6}$/);
    expect(m.visibility).toBe("COURSE");
    expect(m.recordingAccess).toBe("COURSE");
    const student = await as("student");
    expect(await db.videoMeetingParticipant.count({ where: { meetingId: m.id, userId: student.user.id } })).toBe(1);
    expect(await db.notification.count({ where: { userId: student.user.id, type: "video.invited", link: `/video/${m.publicId}` } })).toBe(1);

    // Discovery and joining are refused to people outside the class, with no hint the meeting exists.
    const outsider = await as("faculty.com1");
    expect(await db.videoMeeting.count({ where: { AND: [{ id: m.id }, meetingWhere(outsider)] } })).toBe(0);
    await expect(joinMeeting(outsider, m.publicId)).rejects.toThrow(/does not have permission/);
    await expect(joinMeeting(await as("parent"), m.publicId)).rejects.toThrow(/does not have permission/);

    // The student waits until the host starts; the host joining starts the meeting.
    expect(await joinMeeting(student, m.publicId)).toMatchObject({ status: "waiting" });
    const host = await joinMeeting(faculty, m.publicId);
    expect(host).toMatchObject({ status: "ready", role: "HOST", canPublish: true, isHost: true });
    expect(fake.calls.some((c) => c.op === "createRoom" && c.args[0] === m.roomName)).toBe(true);
    const s = await joinMeeting(student, m.publicId);
    if (s.status !== "ready") throw new Error("not ready");
    expect(s.identity).toBe(`u_${student.user.id}`);
    expect(s.token).not.toContain(process.env.OPENVIDU_API_SECRET ?? "never");
    expect(fake.tokens.at(-1)).toMatchObject({ room: m.roomName, canPublish: true, canPublishData: true });
    await endMeeting(faculty, m.id);
  });

  it("enforces the lifecycle: no starting cancelled meetings, no reviving ended ones", async () => {
    const faculty = await as("faculty.cs1");
    const start = new Date(Date.now() + 120 * MIN);
    const m = await createMeeting(faculty, { title: "Department sync", meetingType: "FACULTY_MEETING", scheduledStart: start, scheduledEnd: new Date(start.getTime() + 30 * MIN) });
    await expect(startMeeting(faculty, m.id)).rejects.toThrow(/from 15 minutes before/);
    await cancelMeeting(faculty, m.id, "Rescheduled to next week");
    await expect(startMeeting(faculty, m.id)).rejects.toThrow(/cancelled/);
    await expect(db.videoMeeting.update({ where: { id: m.id }, data: { status: "SCHEDULED" } })).rejects.toThrow();
    const live = await instantMeeting(faculty, { title: "Quick call" });
    await endMeeting(faculty, live.id);
    await expect(db.videoMeeting.update({ where: { id: live.id }, data: { status: "LIVE" } })).rejects.toThrow();
    await expect(cancelMeeting(faculty, live.id, "too late")).rejects.toThrow(/no longer be cancelled/);
  });

  it("fails gracefully when the video service is down, and can start once it is back", async () => {
    const faculty = await as("faculty.cs1");
    fake.down = true;
    const start = new Date(Date.now() - MIN);
    const m = await createMeeting(faculty, { title: "Outage test", meetingType: "GENERAL_MEETING", scheduledStart: start, scheduledEnd: new Date(start.getTime() + 30 * MIN) });
    await expect(startMeeting(faculty, m.id)).rejects.toThrow("Unable to start the meeting. Please try again.");
    expect((await db.videoMeeting.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("FAILED");
    fake.down = false;
    expect((await startMeeting(faculty, m.id)).status).toBe("LIVE");
    await endMeeting(faculty, m.id);
  });
});

describe("participants, lobby and guests", () => {
  it("holds viva candidates in the lobby until admitted, and removal blocks rejoining", async () => {
    const hod = await as("hod.cs");
    const student = await as("student");
    const examiner = await as("faculty.cs2");
    const start = new Date(Date.now() - MIN);
    const m = await createMeeting(hod, {
      title: "Viva — project", meetingType: "VIVA_VOCE", scheduledStart: start, scheduledEnd: new Date(start.getTime() + 45 * MIN),
      participantIds: [student.user.id, examiner.user.id], panelRoles: { [student.user.id]: "CANDIDATE", [examiner.user.id]: "INTERNAL_EXAMINER" },
    });
    expect(m.visibility).toBe("INVITED");
    expect(m.lobbyEnabled).toBe(true);
    await startMeeting(hod, m.id);
    expect(await joinMeeting(student, m.id)).toEqual({ status: "lobby" });
    const cand = await db.videoMeetingParticipant.findFirstOrThrow({ where: { meetingId: m.id, userId: student.user.id } });
    await expect(decideLobby(student, m.id, cand.id, true)).rejects.toThrow();
    await decideLobby(hod, m.id, cand.id, true);
    expect((await joinMeeting(student, m.id)).status).toBe("ready");

    // Panel notes: the examiner may write, the candidate never sees them.
    await addMeetingNote(examiner, m.id, { kind: "EXAMINER_NOTE", body: "Clear explanation of the design trade-offs." });
    await expect(meetingNotes(student, m.id)).rejects.toThrow();
    expect(await meetingNotes(examiner, m.id)).toHaveLength(1);

    await expect(setParticipantRole(student, m.id, cand.id, "CO_HOST")).rejects.toThrow();
    await removeParticipant(hod, m.id, cand.id);
    expect(fake.calls.some((c) => c.op === "removeParticipant" && c.args[1] === `u_${student.user.id}`)).toBe(true);
    await expect(joinMeeting(student, m.id)).rejects.toThrow(/does not have permission/);
    // Only a deliberate re-add lets them back, and they wait in the lobby again.
    expect(await addParticipants(hod, m.id, { userIds: [student.user.id] })).toBe(1);
    expect((await joinMeeting(student, m.id)).status).toBe("lobby");
    await endMeeting(hod, m.id);
  });

  it("gives guests a time-limited, revocable link", async () => {
    const hod = await as("hod.cs");
    const start = new Date(Date.now() - MIN);
    const m = await createMeeting(hod, { title: "Guest lecture: compilers", meetingType: "GUEST_LECTURE", scheduledStart: start, scheduledEnd: new Date(start.getTime() + 60 * MIN) });
    expect(m.participantsCanPublish).toBe(false);
    const g = await createGuestInvite(hod, m.id, { name: "Prof. External", email: "prof@other.edu", role: "PRESENTER" });
    const token = g.url.split("/").pop()!;
    expect(await db.emailOutbox.count({ where: { to: "prof@other.edu" } })).toBeGreaterThan(0);
    expect(await joinAsGuest(token, "1.1.1.1")).toMatchObject({ status: "waiting" });
    await startMeeting(hod, m.id);
    const j = await joinAsGuest(token, "1.1.1.1");
    expect(j).toMatchObject({ status: "ready", role: "PRESENTER", canPublish: true });
    await revokeGuest(hod, m.id, g.id);
    await expect(joinAsGuest(token, "1.1.1.1")).rejects.toThrow(/not valid|withdrawn/);
    await expect(joinAsGuest("x".repeat(40), "1.1.1.1")).rejects.toThrow(/not valid/);
    await endMeeting(hod, m.id);
  });
});

describe("webhooks and attendance", () => {
  it("rejects unsigned webhooks and applies each event once", async () => {
    expect(await receiveVideoWebhook("{}", "Bearer forged")).toMatchObject({ status: "rejected" });
    const faculty = await as("faculty.cs1");
    const student = await as("student");
    const offering = await bcs304();
    const start = new Date(Date.now() - MIN);
    const noShow = await as("faculty.cs2");
    const m = await createMeeting(faculty, { title: "Attendance test", meetingType: "ONLINE_CLASS", offeringId: offering.id, scheduledStart: start, scheduledEnd: new Date(start.getTime() + 60 * MIN), participantIds: [noShow.user.id] });
    await startMeeting(faculty, m.id);
    const t0 = new Date(Date.now() - 60 * MIN);
    await db.videoMeeting.update({ where: { id: m.id }, data: { actualStart: t0 } });
    const at = (min: number) => new Date(t0.getTime() + min * MIN);
    const sid = `PA_${Date.now()}`;
    const joined = { ...ev("participant_joined", m.roomName, { participant: { sid, identity: `u_${student.user.id}`, name: "Student" } }), at: at(0) };
    expect(await receiveVideoWebhook(JSON.stringify(joined), "Bearer test-signature")).toEqual({ status: "processed" });
    expect(await receiveVideoWebhook(JSON.stringify(joined), "Bearer test-signature")).toEqual({ status: "duplicate" });
    // A second tab overlapping the first must not double-count.
    await processVideoEvent({ ...ev("participant_joined", m.roomName, { participant: { sid: `${sid}_b`, identity: `u_${student.user.id}`, name: "Student" } }), at: at(10) });
    await processVideoEvent({ ...ev("participant_left", m.roomName, { participant: { sid: `${sid}_b`, identity: `u_${student.user.id}`, name: "Student" } }), at: at(20) });
    await processVideoEvent({ ...ev("participant_left", m.roomName, { participant: { sid, identity: `u_${student.user.id}`, name: "Student" } }), at: at(52) });
    expect(await db.videoPresence.count({ where: { meetingId: m.id } })).toBe(2);

    await endMeeting(faculty, m.id, at(60));
    const a = await meetingAttendance(faculty, m.id);
    const row = a.rows.find((r) => r.userId === student.user.id)!;
    expect(row.totalSeconds).toBe(52 * 60);
    expect(row.attendancePercentage).toBeCloseTo(86.67, 1);
    expect(row.attendanceStatus).toBe("PRESENT");
    expect(a.rows.find((r) => r.userId === noShow.user.id)?.attendanceStatus).toBe("ABSENT");

    // Only authorised staff may correct it, with a reason; the student sees only their own row.
    expect((await meetingAttendance(student, m.id)).rows).toHaveLength(1);
    await expect(adjustAttendance(student, row.id, { status: "ABSENT", reason: "testing" })).rejects.toThrow();
    await expect(adjustAttendance(await as("hod.cs"), row.id, { status: "ABSENT", reason: "x" })).rejects.toThrow(/reason/);
    await adjustAttendance(await as("hod.cs"), row.id, { status: "PARTIALLY_PRESENT", reason: "Camera off and unresponsive for the second half" });
    await computeAttendance(m.id); // recomputation keeps manual corrections
    expect((await db.videoMeetingAttendance.findUniqueOrThrow({ where: { id: row.id } })).attendanceStatus).toBe("PARTIALLY_PRESENT");
    expect(await db.auditLog.count({ where: { action: "video.attendance.adjust", resourceId: m.id } })).toBe(1);
  });

  it("ends the meeting when the room closes", async () => {
    const faculty = await as("faculty.cs1");
    const m = await instantMeeting(faculty, { title: "Auto close" });
    await processVideoEvent(ev("room_finished", m.roomName));
    const after = await db.videoMeeting.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.status).toBe("ENDED");
    expect(after.actualEnd).not.toBeNull();
  });
});

describe("recordings and chat", () => {
  it("records, makes the file available, and allows only entitled viewers", async () => {
    const faculty = await as("faculty.cs1");
    const student = await as("student");
    const offering = await bcs304();
    const start = new Date(Date.now() - MIN);
    const m = await createMeeting(faculty, { title: "Recorded class", meetingType: "ONLINE_CLASS", offeringId: offering.id, scheduledStart: start, scheduledEnd: new Date(start.getTime() + 60 * MIN), recordingEnabled: true });
    await expect(startRecording(faculty, m.id)).rejects.toThrow(/once the meeting is live/);
    await startMeeting(faculty, m.id);
    await expect(startRecording(student, m.id)).rejects.toThrow();
    const r = await startRecording(faculty, m.id);
    expect(r.status).toBe("STARTING");
    await expect(startRecording(faculty, m.id)).rejects.toThrow(/already running/);

    // Chat: through the ERP, only for people in the room.
    await processVideoEvent(ev("participant_joined", m.roomName, { participant: { sid: `PC_${Date.now()}`, identity: `u_${student.user.id}`, name: "Student" } }));
    await postChat(student, m.id, { message: "Can you repeat the last slide?" });
    expect(fake.calls.some((c) => c.op === "sendData" && c.args[1] === "chat")).toBe(true);
    expect((await chatHistory(student, m.id)).map((c) => c.message)).toContain("Can you repeat the last slide?");
    await expect(postChat(await as("faculty.com1"), m.id, { message: "hi" })).rejects.toThrow();

    await endMeeting(faculty, m.id);
    expect((await db.videoMeetingRecording.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PROCESSING");
    await processVideoEvent(ev("egress_ended", m.roomName, { recording: { id: r.providerRecordingId, room: m.roomName, state: "COMPLETE", location: `s3://openvidu-appdata/${r.storagePath}`, durationSeconds: 3540, size: BigInt(123456789) } }));
    const done = await db.videoMeetingRecording.findUniqueOrThrow({ where: { id: r.id } });
    expect(done.status).toBe("AVAILABLE");
    expect(done.storagePath).toBe(r.storagePath);
    expect(await db.notification.count({ where: { userId: student.user.id, type: "video.recording" } })).toBeGreaterThan(0);

    const meeting = await db.videoMeeting.findUniqueOrThrow({ where: { id: m.id }, include: { participants: true } });
    expect(await canWatch(student, done, meeting)).toBe(true);
    expect(await canWatch(await as("faculty.com1"), done, meeting)).toBe(false);
    expect(await canWatch(await as("parent"), done, meeting)).toBe(false);

    const url = await playbackUrl(student, r.id);
    const q = new URL(url, "http://x").searchParams;
    expect(url).not.toContain("s3://");
    expect(verifyPlayback(r.id, student.user.id, q.get("exp"), q.get("d"), q.get("sig"))).toBe(true);
    expect(verifyPlayback(r.id, faculty.user.id, q.get("exp"), q.get("d"), q.get("sig"))).toBe(false);
    expect(verifyPlayback(r.id, student.user.id, q.get("exp"), "attachment", q.get("sig"))).toBe(false);
    await expect(playbackUrl(student, r.id, "attachment")).rejects.toThrow(/Downloads are not allowed/);

    await updateRecording(faculty, r.id, { access: "HOST_ONLY" });
    expect(await canWatch(student, await db.videoMeetingRecording.findUniqueOrThrow({ where: { id: r.id } }), meeting)).toBe(false);
    await expect(updateRecording(student, r.id, { access: "PARTICIPANTS" })).rejects.toThrow();
  });
});
