import { afterEach, describe, expect, it } from "vitest";
import { setAiProvider, type AiProvider } from "@/server/ai/gateway";
import { db } from "@/server/db";
import { askAssistant } from "@/server/services/assistant";
import { saveArticle, searchArticles } from "@/server/services/knowledge";
import { assignMentor, meetingsFor, recordMeeting, toggleActionItem } from "@/server/services/mentoring";
import { autoPlan, plannerData, setPlanEntry, whatIf } from "@/server/services/planner";
import { decideConsent } from "@/server/services/privacy";
import { recommendationsFor } from "@/server/services/recommendations";
import { addCaseNote, computeRisks, loadCase, openCase, setCaseStatus } from "@/server/services/success";
import { as } from "./helpers";

afterEach(() => setAiProvider(undefined));

describe("early warning and support cases", () => {
  it("scores every active student of the current term", async () => {
    const r = await computeRisks();
    expect(r.assessed).toBeGreaterThan(10);
    const risk = await db.studentRisk.findFirstOrThrow({ where: { term: { isCurrent: true } } });
    expect(Array.isArray(risk.factors)).toBe(true);
  });

  it("lets teachers of the student open a case, keeps notes append-only and requires a resolution", async () => {
    const o = await db.courseOffering.findFirstOrThrow({ where: { term: { isCurrent: true }, course: { department: { code: "CS" } }, registrations: { some: { status: "REGISTERED", student: { supportCases: { none: {} } } } } }, include: { instructors: { include: { user: true } } } });
    const reg = await db.courseRegistration.findFirstOrThrow({ where: { offeringId: o.id, status: "REGISTERED", student: { supportCases: { none: {} } } } });
    await expect(openCase(await as("faculty.com1"), reg.studentId, { summary: "Concerned about recent absences in class." })).rejects.toThrow();
    const teacher = await as(o.instructors[0].user.email.replace("@example.edu", ""));
    const c = await openCase(teacher, reg.studentId, { summary: "Concerned about recent absences in class.", level: "MEDIUM", details: "Missed the last four lab sessions." });
    await expect(openCase(teacher, reg.studentId, { summary: "A second concern at the same time." })).rejects.toThrow(/already/);
    const note = await db.caseNote.findFirstOrThrow({ where: { caseId: c.id } });
    await expect(db.caseNote.delete({ where: { id: note.id } })).rejects.toThrow();
    const hod = await as("hod.cs");
    await addCaseNote(hod, c.id, { kind: "CONTACT", body: "Spoke to the student's parent by phone." });
    expect((await loadCase(hod, c.id)).case.status).toBe("IN_PROGRESS");
    await expect(setCaseStatus(hod, c.id, { status: "RESOLVED", resolution: "ok" })).rejects.toThrow(/resolved/);
    await setCaseStatus(hod, c.id, { status: "RESOLVED", resolution: "Attendance back above 80% after counselling." });
    await setCaseStatus(hod, c.id, { status: "CLOSED" });
  });

  it("lets a student ask for help and see only their own requests", async () => {
    const student = await as("student");
    await db.supportCase.updateMany({ where: { studentId: student.subject.studentId! }, data: { status: "CLOSED" } });
    const c = await openCase(student, student.subject.studentId!, { summary: "I am finding the DBMS course very hard to follow." });
    expect(c.source).toBe("SELF");
    expect((await loadCase(student, c.id)).case.id).toBe(c.id);
    const other = await db.supportCase.findFirst({ where: { studentId: { not: student.subject.studentId! } } });
    if (other) await expect(loadCase(student, other.id)).rejects.toThrow(/not found/);
  });
});

describe("mentoring", () => {
  it("assigns mentors in scope and shares meeting summaries but not private notes", async () => {
    const hod = await as("hod.cs");
    const cs = await db.student.findFirstOrThrow({ where: { status: "ACTIVE", department: { code: "CS" } }, orderBy: { studentNo: "desc" } });
    const com = await db.student.findFirstOrThrow({ where: { status: "ACTIVE", department: { code: "COM" } } });
    const mentor = await db.user.findUniqueOrThrow({ where: { email: "faculty.cs2@example.edu" } });
    await expect(assignMentor(hod, { mentorId: mentor.id, studentIds: [com.id] })).rejects.toThrow(/permission/);
    await assignMentor(hod, { mentorId: mentor.id, studentIds: [cs.id] });
    expect(await db.mentorAssignment.count({ where: { studentId: cs.id, endsOn: null } })).toBe(1);
    await expect(recordMeeting(await as("faculty.cs1"), cs.id, { heldOn: new Date(), mode: "IN_PERSON", summary: "Not my mentee, should fail." })).rejects.toThrow(/mentor/);
    const fac = await as("faculty.cs2");
    const m = await recordMeeting(fac, cs.id, { heldOn: new Date(Date.now() - 3600_000), mode: "ONLINE", summary: "Discussed elective choices for next semester.", actionItems: "Read the elective handbook\nMeet the HoD", privateNotes: "Family situation is difficult." });
    expect((m.actionItems as unknown[]).length).toBe(2);
    expect((await meetingsFor(fac, cs.id))[0].privateNotes).toBe("Family situation is difficult.");
    expect((await meetingsFor(await as("dean.science"), cs.id).catch(() => [{ privateNotes: null }]))[0].privateNotes).toBeNull();
  });

  it("lets the student tick off their action items", async () => {
    const student = await as("student");
    const m = await db.mentorMeeting.findFirstOrThrow({ where: { studentId: student.subject.studentId! } });
    await toggleActionItem(student, m.id, 0);
    const mine = await meetingsFor(student, student.subject.studentId!);
    expect(mine.every((x) => x.privateNotes === null)).toBe(true);
  });
});

describe("knowledge base and assistant", () => {
  it("manages articles and ranks title matches first", async () => {
    await expect(saveArticle(await as("faculty.cs1"), null, { title: "Should not be allowed", category: "X", audience: "ALL", body: "Some long enough body text for the article.", published: true })).rejects.toThrow(/permission/);
    await saveArticle(await as("uniadmin"), null, { title: "Internal staff procedure for timetable swaps", category: "Staff guides", audience: "STAFF", body: "Staff-only procedure to swap a class slot with a colleague.", published: true });
    const student = await as("student");
    const hits = await searchArticles(student, "revaluation fee");
    expect(hits[0].title).toMatch(/revaluation/i);
    expect((await searchArticles(student, "timetable swaps")).some((a) => a.audience === "STAFF")).toBe(false);
  });

  it("answers without an AI provider, and uses the student's records only after consent", async () => {
    setAiProvider(null);
    const student = await as("student");
    const before = await askAssistant(student, { message: "What is my attendance this term?" });
    expect(before.mode).toBe("search");
    expect(before.usedRecords).toBe(false);
    const notice = await db.consentNotice.findFirstOrThrow({ where: { key: "ai.assistant", active: true } });
    await decideConsent(student, { noticeId: notice.id, decision: "GRANTED" });
    const after = await askAssistant(student, { message: "What is my attendance this term?" });
    expect(after.usedRecords).toBe(true);
    expect(after.answer).toMatch(/%|no classes held/);
    const unknown = await askAssistant(student, { message: "Can I bring my pet tortoise to the convocation ceremony?" });
    expect(unknown.action?.type === "ticket" || unknown.sources.length > 0).toBe(true);
    await expect(askAssistant(await as("registrar"), { message: "What is my attendance?" })).rejects.toThrow(/portal/);
  });

  it("uses the AI provider when configured and only proposes actions", async () => {
    let system = "";
    const fake: AiProvider = { name: "test", model: "test-model", complete: async (i) => { system = i.system; return { text: JSON.stringify({ answer: "Apply from the Results page within the revaluation window.", action: { type: "link", page: "results" } }), inputTokens: 10, outputTokens: 10 }; } };
    setAiProvider(fake);
    const student = await as("student");
    const r = await askAssistant(student, { message: "How do I apply for revaluation?", history: [{ role: "user", content: "hello" }, { role: "assistant", content: "Hi!" }] });
    expect(r.mode).toBe("ai");
    expect(r.action).toMatchObject({ type: "link", href: "/portal/results" });
    expect(system).toMatch(/Knowledge base/);
    expect(await db.aiRequest.count({ where: { userId: student.user.id, feature: "studentAssistant" } })).toBeGreaterThan(0);
  });
});

describe("degree planner and recommendations", () => {
  it("plans the remaining mandatory courses and checks the plan", async () => {
    const student = await as("student");
    const sid = student.subject.studentId!;
    const data = await plannerData(student, sid);
    expect(data).not.toBeNull();
    const todo = data!.courses.find((c) => c.status === "TODO");
    if (todo) await expect(setPlanEntry(student, sid, { courseId: todo.courseId, semester: data!.student.currentSemester })).rejects.toThrow(/later/);
    await autoPlan(student, sid);
    const after = await plannerData(student, sid);
    expect(after!.check.issues.filter((i) => i.kind === "MISSING_MANDATORY" || i.kind === "PREREQUISITE")).toHaveLength(0);
    await expect(autoPlan(await as("faculty.com1"), sid)).rejects.toThrow();
    const other = await db.program.findFirstOrThrow({ where: { id: { not: data!.student.programId }, curricula: { some: { status: "ACTIVE" } } } });
    const wi = await whatIf(student, sid, other.id);
    expect(wi.audit.requiredCredits).toBeGreaterThan(0);
  });

  it("recommends material for outcomes where the student scored low", async () => {
    const student = await as("student");
    const sid = student.subject.studentId!;
    const reg = await db.courseRegistration.findFirstOrThrow({ where: { studentId: sid, status: "REGISTERED", offering: { term: { isCurrent: true }, quizzes: { some: { questions: { some: { outcomeId: { not: null } } } } } } }, include: { offering: { include: { quizzes: { include: { questions: true } } } } } });
    const quiz = reg.offering.quizzes.find((q) => q.questions.some((x) => x.outcomeId))!;
    const q = quiz.questions.find((x) => x.outcomeId)!;
    await db.learningItemOutcome.createMany({ data: (await db.learningItem.findMany({ where: { module: { offeringId: reg.offeringId }, isPublished: true }, take: 1 })).map((i) => ({ itemId: i.id, outcomeId: q.outcomeId! })), skipDuplicates: true });
    await db.quizAttempt.deleteMany({ where: { quizId: quiz.id, studentId: sid } });
    await db.quizAttempt.create({ data: { quizId: quiz.id, studentId: sid, attemptNo: 1, deadlineAt: new Date(), submittedAt: new Date(), status: "SUBMITTED", questionOrder: [q.id], answers: {}, marksAwarded: { [q.id]: 0 }, score: 0, maxScore: q.marks } }).catch(() => undefined);
    const recs = await recommendationsFor(student, sid);
    const mine = recs.find((r) => r.offering.id === reg.offeringId);
    expect(mine?.weak.some((w) => w.outcomeId === q.outcomeId)).toBe(true);
    await expect(recommendationsFor(await as("registrar"), sid)).rejects.toThrow();
  });
});
