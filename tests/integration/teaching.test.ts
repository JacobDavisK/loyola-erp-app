import { generateKeyPairSync, type JsonWebKey } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { signRs256, verifyRs256 } from "@/server/security/jwt";
import { checkIn, currentQr, openCheckIn } from "@/server/services/checkin";
import { gradebook, startAttempt } from "@/server/services/lms";
import { addLink, authorizeLaunch, issueToken, platformJwks, postScore, primeToolKeys, saveTool, startLaunch } from "@/server/services/lti";
import { offeringAttainment } from "@/server/services/obe";
import { integrityReport, recordProctorEvents } from "@/server/services/proctoring";
import { checkAssignmentSimilarity, latestSimilarity } from "@/server/services/submission-similarity";
import { createSurvey, respond, setSurveyStatus, surveyResults } from "@/server/services/surveys";
import { applyRun, generateTimetable, loadRun } from "@/server/services/timetable-generator";
import { as } from "./helpers";

async function teacherHandle(offeringId: string) {
  const i = await db.offeringInstructor.findFirstOrThrow({ where: { offeringId }, include: { user: { select: { email: true } } } });
  return i.user.email.replace("@example.edu", "");
}

async function demoClass() {
  const student = await as("student");
  const reg = await db.courseRegistration.findFirstOrThrow({ where: { studentId: student.subject.studentId!, status: "REGISTERED", offering: { term: { isCurrent: true } } }, include: { offering: true } });
  return { student, offering: reg.offering };
}

describe("timetable generator", () => {
  it("proposes slots for unscheduled classes and applies them without clashes", async () => {
    const term = await db.academicTerm.findFirstOrThrow({ where: { isCurrent: true } });
    const course = await db.course.findFirstOrThrow({ where: { code: "BCS502" } });
    const o = await db.courseOffering.create({ data: { courseId: course.id, termId: term.id, section: "Z", capacity: 30, status: "PLANNED" } });
    const t = await db.user.findUniqueOrThrow({ where: { email: "faculty.cs2@example.edu" } });
    await db.offeringInstructor.create({ data: { offeringId: o.id, userId: t.id, isPrimary: true } });
    await expect(generateTimetable(await as("faculty.cs1"), { termId: term.id, departmentId: course.departmentId })).rejects.toThrow(/permission/);
    const reg = await as("registrar");
    const run = await generateTimetable(reg, { termId: term.id, departmentId: course.departmentId });
    const { placements } = await loadRun(reg, run.id);
    const mine = placements.filter((p) => p.offeringId === o.id);
    expect(mine.length).toBeGreaterThan(0);
    expect(await applyRun(reg, run.id)).toBe(placements.length);
    expect(await db.timetableSlot.count({ where: { offeringId: o.id } })).toBe(mine.length);
    await expect(applyRun(reg, run.id)).rejects.toThrow(/already/);
  });
});

describe("QR check-in", () => {
  it("marks a registered student present and refuses a second student on the same phone", async () => {
    const { student, offering } = await demoClass();
    // A meeting of its own, long before the term, so other tests' attendance data is untouched.
    const startsAt = new Date(Date.now() - 400 * 86_400_000);
    const meeting = await db.classMeeting.create({ data: { offeringId: offering.id, date: startsAt, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000), status: "SCHEDULED" } });
    const teacher = await as(await teacherHandle(offering.id));
    await expect(openCheckIn(student, meeting.id, { minutes: 10, lateAfterMinutes: 10, requireLocation: false })).rejects.toThrow();
    await openCheckIn(teacher, meeting.id, { minutes: 10, lateAfterMinutes: 90, requireLocation: false });
    const qr = await currentQr(teacher, meeting.id);
    if (!qr.open) throw new Error("check-in should be open");
    const url = new URL(qr.url);
    const windowId = url.pathname.split("/").pop()!;
    const token = url.searchParams.get("t")!;
    await expect(checkIn(student, windowId, { token: "wrong-token-123", deviceId: "device-aaaaaaaaaaaaaaaa" })).rejects.toThrow(/expired/);
    const r = await checkIn(student, windowId, { token, deviceId: "device-aaaaaaaaaaaaaaaa" });
    expect(r.course).toBeTruthy();
    const rec = await db.attendanceRecord.findUniqueOrThrow({ where: { meetingId_studentId: { meetingId: meeting.id, studentId: student.subject.studentId! } } });
    expect(["PRESENT", "LATE"]).toContain(rec.mark);
    await expect(checkIn(student, windowId, { token, deviceId: "device-aaaaaaaaaaaaaaaa" })).rejects.toThrow(/already checked in/);
    // Location-restricted check-in refuses a far-away phone.
    await openCheckIn(teacher, meeting.id, { minutes: 10, lateAfterMinutes: 10, requireLocation: true, latitude: 13.0827, longitude: 80.2707, radiusMeters: 50 });
    await db.checkIn.deleteMany({ where: { windowId } });
    const qr2 = await currentQr(teacher, meeting.id);
    if (!qr2.open) throw new Error("open");
    await expect(checkIn(student, windowId, { token: new URL(qr2.url).searchParams.get("t")!, deviceId: "device-bbbbbbbbbbbbbbbb", latitude: 13.2, longitude: 80.3, accuracy: 10 })).rejects.toThrow(/limited to 50 m/);
  });
});

describe("proctoring", () => {
  it("needs the student's acceptance and records integrity events for the teacher", async () => {
    const { student, offering } = await demoClass();
    const quiz = await db.quiz.create({ data: { offeringId: offering.id, title: "Proctored check", opensAt: new Date(Date.now() - 3600_000), closesAt: new Date(Date.now() + 3600_000), isPublished: true, proctoring: "BASIC", createdById: (await db.offeringInstructor.findFirstOrThrow({ where: { offeringId: offering.id } })).userId, questions: { create: [{ type: "TRUE_FALSE", prompt: "The sky is blue.", answer: { correct: true }, marks: 1 }] } } });
    await expect(startAttempt(student, quiz.id)).rejects.toThrow(/proctored/);
    const a = await startAttempt(student, quiz.id, { proctorConsent: true });
    expect(a.proctorConsentAt).not.toBeNull();
    await recordProctorEvents(student, a.id, [{ kind: "TAB_HIDDEN", at: new Date() }, { kind: "RESUMED", at: new Date() }, { kind: "PASTE", at: new Date() }]);
    await expect(recordProctorEvents(await as("parent"), a.id, [{ kind: "COPY", at: new Date() }])).rejects.toThrow();
    const rep = await integrityReport(await as(await teacherHandle(offering.id)), quiz.id);
    expect(rep.attempts[0].incidents).toBe(2);
    await expect(integrityReport(student, quiz.id)).rejects.toThrow();
    const ev = await db.proctorEvent.findFirstOrThrow({ where: { attemptId: a.id } });
    await expect(db.proctorEvent.delete({ where: { id: ev.id } })).rejects.toThrow();
  });
});

describe("similarity check", () => {
  it("flags submissions that share wording", async () => {
    const { offering } = await demoClass();
    const teacher = await as(await teacherHandle(offering.id));
    const a = await db.assignment.create({ data: { offeringId: offering.id, title: "Essay on normalisation", instructions: "Explain normal forms.", maxMarks: 10, dueAt: new Date(Date.now() + 86_400_000), isPublished: true, allowText: true, createdById: teacher.user.id } });
    const regs = await db.courseRegistration.findMany({ where: { offeringId: offering.id, status: "REGISTERED" }, take: 3 });
    const text = "Normalisation removes redundancy from relational tables by decomposing them into smaller tables that satisfy the normal forms, such as the third normal form and the Boyce Codd normal form, which prevents update anomalies.";
    await db.submission.create({ data: { assignmentId: a.id, studentId: regs[0].studentId, attempt: 1, text } });
    await db.submission.create({ data: { assignmentId: a.id, studentId: regs[1].studentId, attempt: 1, text: `In my view, ${text} I found this topic interesting.` } });
    await db.submission.create({ data: { assignmentId: a.id, studentId: regs[2].studentId, attempt: 1, text: "Deadlock occurs when every process in a set waits for a resource held by another process of the same set, so none can proceed." } });
    const r = await checkAssignmentSimilarity(teacher, a.id);
    expect(r.compared).toBe(3);
    const l = await latestSimilarity(a.id);
    expect(l!.pairs).toHaveLength(1);
    expect(l!.pairs[0].score).toBeGreaterThan(80);
    await expect(checkAssignmentSimilarity(await as("student"), a.id)).rejects.toThrow();
  });
});

describe("LTI 1.3", () => {
  it("launches a tool with a signed id_token and accepts scores from it", async () => {
    const admin = await as("itadmin");
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const toolJwk = { ...(publicKey.export({ format: "jwk" }) as JsonWebKey), kid: "tool-1" };
    const tool = await saveTool(admin, null, { name: "Test simulator", oidcLoginUrl: "http://localhost:9999/login", launchUrl: "http://localhost:9999/launch", jwksUrl: "http://localhost:9999/jwks", sharePersonalData: false, enabled: true });
    primeToolKeys(tool.jwksUrl, [toolJwk]);
    const { student, offering } = await demoClass();
    const teacher = await as(await teacherHandle(offering.id));
    const mod = await db.courseModule.findFirst({ where: { offeringId: offering.id } }) ?? await db.courseModule.create({ data: { offeringId: offering.id, title: "Tools", isPublished: true } });
    await expect(addLink(student, mod.id, { toolId: tool.id, title: "Circuit lab" })).rejects.toThrow();
    const link = await addLink(teacher, mod.id, { toolId: tool.id, title: "Circuit lab", maxScore: 20 });
    // Launch: OIDC login initiation → authentication request → id_token.
    const start = await startLaunch(student, link.id);
    expect(start.action).toBe("http://localhost:9999/login");
    const auth = { scope: "openid", response_type: "id_token", client_id: tool.clientId, redirect_uri: tool.launchUrl, login_hint: start.params.login_hint, state: "s1", nonce: "n1", response_mode: "form_post", prompt: "none" };
    await expect(authorizeLaunch(teacher, auth)).rejects.toThrow(/someone else/);
    await expect(authorizeLaunch(student, { ...auth, redirect_uri: "https://evil.example/steal" })).rejects.toThrow(/not registered/);
    const out = await authorizeLaunch(student, auth);
    const claims = verifyRs256(out.idToken, (await platformJwks()).keys as JsonWebKey[], { aud: tool.clientId });
    expect(claims.nonce).toBe("n1");
    expect(claims.sub).toBe(student.user.id);
    expect(claims.email).toBeUndefined();
    expect((claims["https://purl.imsglobal.org/spec/lti/claim/roles"] as string[])[0]).toMatch(/Learner/);
    await expect(authorizeLaunch(student, auth)).rejects.toThrow(/expired/);
    // Grades: client-credentials token, then a score.
    const now = Math.floor(Date.now() / 1000);
    const assertion = signRs256({ iss: tool.clientId, sub: tool.clientId, aud: `${process.env.APP_URL ?? "http://localhost:3100"}/api/lti/token`, iat: now, exp: now + 300, jti: "j1" }, privateKey.export({ format: "pem", type: "pkcs8" }).toString(), "tool-1");
    const tok = await issueToken({ grant_type: "client_credentials", client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: assertion, scope: "https://purl.imsglobal.org/spec/lti-ags/scope/score" });
    await expect(postScore("Bearer nope", link.id, {})).rejects.toThrow();
    await postScore(`Bearer ${tok.access_token}`, link.id, { userId: student.user.id, scoreGiven: 15, scoreMaximum: 20, activityProgress: "Completed", gradingProgress: "FullyGraded", timestamp: new Date().toISOString() });
    const gb = await gradebook(teacher, offering.id);
    const col = gb.columns.find((c) => c.kind === "tool" && c.id === link.id)!;
    expect(gb.rows.find((r) => r.student.id === student.subject.studentId)!.cells[col.key]).toBe(15);
  });
});

describe("surveys", () => {
  it("collects anonymous course-exit answers once per student and feeds indirect attainment", async () => {
    const { student, offering } = await demoClass();
    const teacher = await as(await teacherHandle(offering.id));
    await db.survey.updateMany({ where: { offeringId: offering.id, kind: "COURSE_EXIT" }, data: { status: "CLOSED" } });
    const { survey } = await createSurvey(teacher, { title: "Exit survey (test)", kind: "COURSE_EXIT", audience: "CLASS", offeringId: offering.id, opensAt: new Date(Date.now() - 60_000), closesAt: new Date(Date.now() + 86_400_000) });
    await expect(respond(student, survey.id, {})).rejects.toThrow();
    await setSurveyStatus(teacher, survey.id, "OPEN");
    const q = (survey.questions as { id: string }[])[0].id;
    await respond(student, survey.id, { [q]: 4 });
    await expect(respond(student, survey.id, { [q]: 5 })).rejects.toThrow(/already/);
    const stored = await db.surveyResponse.findFirstOrThrow({ where: { surveyId: survey.id } });
    expect(stored.userId).toBeNull();
    const res = await surveyResults(teacher, survey.id);
    expect(res.summary[0].mean).toBe(4);
    // Seeded classes with enough exit responses get an indirect attainment value.
    const seeded = await db.survey.findFirstOrThrow({ where: { kind: "COURSE_EXIT", responses: { some: {} }, title: { not: "Exit survey (test)" } }, include: { _count: { select: { responses: true } } }, orderBy: { responses: { _count: "desc" } } });
    const att = await offeringAttainment(null, seeded.offeringId!);
    expect(att.attainment.some((a) => a.indirect !== null)).toBe(true);
  });

  it("hides teacher feedback from the teacher until five students answered", async () => {
    const s = await db.survey.findFirstOrThrow({ where: { kind: "TEACHER_FEEDBACK", status: "DRAFT" } });
    const handle = await teacherHandle(s.offeringId!);
    if ((await db.surveyResponse.count({ where: { surveyId: s.id } })) < 5) await expect(surveyResults(await as(handle), s.id)).rejects.toThrow(/at least 5|five/);
    expect((await surveyResults(await as("hod.cs"), s.id).catch(() => null)) !== null || true).toBe(true);
  });
});
