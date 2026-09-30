import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { verifySeal } from "@/server/services/credential-issue";
import { issueForStudent, requestCredential, verifyCredential } from "@/server/services/credentials";
import { allocateSitting, assignInvigilator, generateExamRegistrations, hallTicket, issueHallTickets } from "@/server/services/exam-ops";
import { markGrid, saveComponent, saveMarks, submitSheet } from "@/server/services/marks";
import { computeRun, createRun, submitRun } from "@/server/services/results";
import { completeRevaluation, requestRevaluation, settleRevaluationFee, startRevaluation, submitRevaluationMarks } from "@/server/services/revaluation";
import { assignValuers, codeScripts, myValuations, submitValuation } from "@/server/services/valuation";
import { decideTask } from "@/server/services/workflow";
import { as } from "./helpers";

/**
 * End-to-end: exam registration → hall tickets → seating → anonymous double valuation → internal marks
 * through approval → result computation → three-step publication → immutability → revaluation (new
 * version, history kept) → transcript with a verifiable seal.
 */
let sessionId: string;
let exam303: { id: string; courseId: string };

const approveAll = async (instanceId: string) => {
  for (let i = 0; i < 6; i++) {
    const task = await db.workflowTask.findFirst({ where: { instanceId, status: "PENDING" }, include: { assignee: true } });
    if (!task) return;
    await decideTask(await as(task.assignee.email.replace("@example.edu", "")), task.id, { decision: "approve" });
  }
};

beforeAll(async () => {
  sessionId = (await db.examinationSession.findUniqueOrThrow({ where: { code: "NOV2026" } })).id;
  const course = await db.course.findFirstOrThrow({ where: { code: "BCS303" } });
  exam303 = await db.examination.findFirstOrThrow({ where: { sessionId, courseId: course.id } });
});

describe("examination operations", () => {
  it("derives eligibility from registrations and attendance", async () => {
    const coe = await as("controller");
    const r = await generateExamRegistrations(coe, sessionId);
    expect(r.created).toBeGreaterThan(50);
    const regs = await db.examRegistration.findMany({ where: { examinationId: exam303.id } });
    expect(regs.length).toBe(24);
    // Seeded truants fall below 75%.
    expect(regs.some((x) => x.status !== "ELIGIBLE")).toBe(true);
    // Re-running is idempotent.
    expect((await generateExamRegistrations(coe, sessionId)).created).toBe(0);
  });

  it("issues hall tickets with anonymous dummy numbers and seats candidates", async () => {
    const coe = await as("controller");
    // Confirm the non-eligible 303 candidates too, so every script exists for the rest of the test.
    await db.examRegistration.updateMany({ where: { examinationId: exam303.id, status: { not: "ELIGIBLE" } }, data: { status: "ELIGIBLE", reasons: [] } });
    const { issued } = await issueHallTickets(coe, sessionId);
    expect(issued).toBeGreaterThan(24);
    const regs = await db.examRegistration.findMany({ where: { examinationId: exam303.id } });
    expect(regs.every((x) => x.status === "REGISTERED" && x.dummyNo && x.hallTicketNo)).toBe(true);
    const student = await as("student");
    const ticket = await hallTicket(student, student.subject.studentId!, sessionId);
    expect(ticket.papers.length).toBeGreaterThanOrEqual(5);
    await expect(hallTicket(await as("parent"), regs.find((x) => x.studentId !== student.subject.studentId)!.studentId, sessionId)).rejects.toThrow(/not found/i);

    const schedule = await db.examSchedule.findUniqueOrThrow({ where: { examinationId: exam303.id } });
    const hall = await db.room.findUniqueOrThrow({ where: { code: "SB-EH" } });
    const seated = await allocateSitting(coe, sessionId, { date: schedule.date, slot: schedule.slot, roomIds: [hall.id] });
    expect(seated.seated).toBeGreaterThanOrEqual(24);
    // Neighbouring seats hold different papers where more than one paper is written.
    const seats = await db.examSeat.findMany({ where: { roomId: hall.id, date: schedule.date, slot: schedule.slot }, include: { registration: true }, orderBy: { seatNo: "asc" } });
    const papers = new Set(seats.map((x) => x.registration.examinationId));
    if (papers.size > 1) expect(seats[0].registration.examinationId).not.toBe(seats[1].registration.examinationId);
    const fac = await db.user.findUniqueOrThrow({ where: { email: "faculty.com1@example.edu" } });
    await assignInvigilator(coe, sessionId, { userId: fac.id, roomId: hall.id, date: schedule.date, slot: schedule.slot });
    await expect(assignInvigilator(coe, sessionId, { userId: fac.id, roomId: hall.id, date: schedule.date, slot: schedule.slot })).rejects.toThrow(/already has a duty/);
  });

  it("values scripts anonymously with double and third valuation", async () => {
    const coe = await as("controller");
    expect((await codeScripts(coe, exam303.id)).created).toBe(24);
    const [v1, v2, v3] = await Promise.all(["valuer1", "valuer2", "valuer3"].map((h) => db.user.findUniqueOrThrow({ where: { email: `${h}@example.edu` } })));
    await assignValuers(coe, exam303.id, { round: 1, valuerIds: [v1.id] });
    await assignValuers(coe, exam303.id, { round: 2, valuerIds: [v1.id, v2.id] });
    // Round 2 never goes to the round-1 valuer.
    const r2 = await db.scriptValuation.findMany({ where: { round: 2, script: { examinationId: exam303.id } } });
    expect(r2.every((x) => x.valuerId === v2.id)).toBe(true);

    const q1 = await myValuations(await as("valuer1"));
    expect(JSON.stringify(q1)).not.toMatch(/studentNo|firstName/);
    // Marks depend on the script, so both valuers agree (±1) except on one script.
    const base = (dummy: string) => 40 + ([...dummy].reduce((a, c) => a + c.charCodeAt(0), 0) % 20);
    for (const item of q1.filter((x) => !x.submittedAt)) await submitValuation(await as("valuer1"), item.id, { marks: base(item.script.registration.dummyNo!) });
    const q2 = (await myValuations(await as("valuer2"))).filter((x) => !x.submittedAt);
    for (const [i, item] of q2.entries()) await submitValuation(await as("valuer2"), item.id, { marks: i === 0 ? 5 : base(item.script.registration.dummyNo!) + 1 });
    const third = await db.answerScript.count({ where: { examinationId: exam303.id, status: "THIRD_VALUATION" } });
    expect(third).toBe(1);
    await assignValuers(coe, exam303.id, { round: 3, valuerIds: [v3.id] });
    const q3 = (await myValuations(await as("valuer3"))).filter((x) => !x.submittedAt);
    await submitValuation(await as("valuer3"), q3[0].id, { marks: 44 });
    expect(await db.answerScript.count({ where: { examinationId: exam303.id, status: "FINAL" } })).toBe(24);
    await expect(submitValuation(await as("valuer3"), q3[0].id, { marks: 50 })).rejects.toThrow(/already submitted/);
  });

  it("routes internal marks through HoD verification", async () => {
    const offering = await db.courseOffering.findFirstOrThrow({ where: { courseId: exam303.courseId, term: { isCurrent: true } } });
    const teacher = await as("setter2");
    const comp = await saveComponent(teacher, offering.id, null, { name: "Internal test", kind: "INTERNAL", maxMarks: 50, weight: 25 });
    await expect(saveComponent(teacher, offering.id, null, { name: "Extra", kind: "INTERNAL", maxMarks: 10, weight: 5 })).rejects.toThrow(/more than the course/);
    const grid = await markGrid(teacher, comp.id);
    await expect(submitSheet(teacher, comp.id)).rejects.toThrow(/no mark/);
    await saveMarks(teacher, comp.id, { entries: grid.rows.map((row, i) => ({ studentId: row.student.id, marks: 25 + (i % 20), status: "PRESENT" })) });
    await expect(saveMarks(teacher, comp.id, { entries: [{ studentId: grid.rows[0].student.id, marks: 60, status: "PRESENT" }] })).rejects.toThrow(/cannot exceed/i);
    const inst = await submitSheet(teacher, comp.id);
    await expect(saveMarks(teacher, comp.id, { entries: [{ studentId: grid.rows[0].student.id, marks: 30, status: "PRESENT" }] })).rejects.toThrow(/awaiting approval/);
    await approveAll(inst.id);
    expect((await db.markSheet.findUniqueOrThrow({ where: { componentId: comp.id } })).status).toBe("APPROVED");
  });
});

describe("results", () => {
  it("computes, approves in three steps and publishes; published rows are immutable", async () => {
    const coe = await as("controller");
    // Only BCS303 is complete in this test; set the other BCA papers aside.
    await db.examRegistration.updateMany({ where: { sessionId, examinationId: { not: exam303.id }, examination: { course: { program: { code: "BCA" } } } }, data: { status: "CANCELLED" } });
    const bca = await db.program.findUniqueOrThrow({ where: { code: "BCA" } });
    const run = await createRun(coe, { sessionId, programId: bca.id });
    const stats = await computeRun(coe, run.id);
    expect(stats.courses).toBe(24);
    expect(stats.incomplete).toBe(0);
    const inst = await submitRun(coe, run.id);
    const steps = await db.workflowTask.findMany({ where: { instanceId: inst.id }, include: { assignee: true } });
    expect(steps.map((t) => t.stepKey)).toEqual(["department"]);
    await approveAll(inst.id);
    const published = await db.resultRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(published.status).toBe("PUBLISHED");
    const one = await db.courseResult.findFirstOrThrow({ where: { runId: run.id } });
    expect(one.publishedAt).not.toBeNull();
    await expect(db.courseResult.update({ where: { id: one.id }, data: { grade: "O" } })).rejects.toThrow(/cannot be changed/);
    await expect(db.courseResult.delete({ where: { id: one.id } })).rejects.toThrow(/cannot be deleted/);
    const term = await db.termResult.findFirstOrThrow({ where: { runId: run.id, studentId: one.studentId } });
    expect(term.cgpa).not.toBeNull();
  });

  it("revaluation creates a new version and keeps the original", async () => {
    const student = await as("student");
    const cr = await db.courseResult.findFirstOrThrow({ where: { studentId: student.subject.studentId!, course: { code: "BCS303" }, isCurrent: true } });
    const req = await requestRevaluation(student, cr.id, { type: "REVALUATION" });
    expect(req.status).toBe("FEE_PENDING");
    const coe = await as("controller");
    await expect(startRevaluation(coe, req.id, {})).rejects.toThrow(/fee/i);
    await settleRevaluationFee(coe, req.id, { reference: "RCPT-TEST-1" });
    const v1 = await db.user.findUniqueOrThrow({ where: { email: "valuer1@example.edu" } });
    await expect(startRevaluation(coe, req.id, { valuerId: v1.id })).rejects.toThrow(/has not valued/);
    const role = await db.role.findUniqueOrThrow({ where: { key: "VALUER" } });
    const fresh = await db.user.create({ data: { email: "revaluer@example.edu", employeeId: "EXT9001", name: "Revaluation Examiner", passwordHash: "x", roles: { create: [{ roleId: role.id }] } } });
    await startRevaluation(coe, req.id, { valuerId: fresh.id });
    const task = await db.scriptValuation.findFirstOrThrow({ where: { valuerId: fresh.id, round: { gte: 10 } } });
    await submitRevaluationMarks(await as(fresh.email.replace("@example.edu", "")), task.id, { marks: 75 });
    const out = await completeRevaluation(coe, req.id, {});
    expect(out.outcome).toBe("INCREASED");
    const versions = await db.courseResult.findMany({ where: { studentId: cr.studentId, courseId: cr.courseId, termId: cr.termId }, orderBy: { version: "asc" } });
    expect(versions.length).toBe(2);
    expect(versions[0].isCurrent).toBe(false);
    expect(versions[1].isCurrent).toBe(true);
    expect(versions[1].externalMarks).toBe(75);
    expect(versions[1].revisionReason).toMatch(/Revaluation/);
  });

  it("issues a transcript whose seal verifies and detects tampering", async () => {
    const reg = await as("registrar");
    const student = await as("student");
    const cred = await issueForStudent(reg, student.subject.studentId!, { type: "TRANSCRIPT" });
    const v = await verifyCredential(cred.verificationCode, "test");
    expect(v?.intact).toBe(true);
    expect(v?.status).toBe("ISSUED");
    expect(verifySeal({ ...(cred.payload as object), cgpa: 10 }, cred.contentHash, cred.seal)).toBe(false);
    await expect(db.issuedCredential.update({ where: { id: cred.id }, data: { payload: {} } })).rejects.toThrow(/cannot be changed/);
    const again = await issueForStudent(reg, student.subject.studentId!, { type: "TRANSCRIPT" });
    expect((await db.issuedCredential.findUniqueOrThrow({ where: { id: cred.id } })).status).toBe("SUPERSEDED");
    expect(again.serialNo).not.toBe(cred.serialNo);
    expect(await verifyCredential("NOPE-NOPE-NOPE", "test")).toBeNull();
  });
});

describe("certificate requests", () => {
  it("a student's request is issued automatically when the Registrar approves", async () => {
    const student = await as("student");
    const inst = await requestCredential(student, { type: "BONAFIDE_CERTIFICATE", purpose: "Bank education loan application" });
    const task = await db.workflowTask.findFirstOrThrow({ where: { instanceId: inst.id, status: "PENDING" }, include: { assignee: true } });
    expect(task.assignee.email).toBe("registrar@example.edu");
    await decideTask(await as("registrar"), task.id, { decision: "approve" });
    const cred = await db.issuedCredential.findFirstOrThrow({ where: { studentId: student.subject.studentId!, type: "BONAFIDE_CERTIFICATE" } });
    expect((cred.payload as { statement: string }).statement).toMatch(/bonafide student/);
    expect((cred.payload as { purpose: string }).purpose).toBe("Bank education loan application");
    await expect(requestCredential(student, { type: "DEGREE_CERTIFICATE", purpose: "Job application" })).rejects.toThrow(/cannot be requested/);
    await expect(requestCredential(await as("parent"), { type: "BONAFIDE_CERTIFICATE", purpose: "Scholarship" })).rejects.toThrow(/permission/i);
  });
});
