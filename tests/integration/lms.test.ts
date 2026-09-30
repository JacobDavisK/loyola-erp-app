import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  courseSpace, gradebook, gradeSubmission, openItem, postAnnouncement, releaseGrades, saveAnswers, saveAssignment, saveItem, saveModule, saveQuestion, saveQuiz,
  startAttempt, submitAssignment, submitAttempt, transferToComponent, uploadMaterial,
} from "@/server/services/lms";
import { as } from "./helpers";

const offering = async () => db.courseOffering.findFirstOrThrow({ where: { course: { code: "BCS301" }, section: "A", term: { isCurrent: true } } });
const form = (entries: Record<string, string | File | File[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
const pdf = (name: string) => new File([Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF")], name, { type: "application/pdf" });
const hour = 3_600_000;

describe("course space access", () => {
  it("gives instructors, department managers and registered students their roles, and hides it from others", async () => {
    const o = await offering();
    expect((await courseSpace(await as("setter"), o.id)).role).toBe("teacher");
    expect((await courseSpace(await as("hod.cs"), o.id)).role).toBe("manager");
    expect((await courseSpace(await as("student"), o.id)).role).toBe("student");
    await expect(courseSpace(await as("faculty.com1"), o.id)).rejects.toThrow(/not found/);
    await expect(saveModule(await as("student"), o.id, null, { title: "Hacked" })).rejects.toThrow(/instructors/);
  });
});

describe("content", () => {
  it("publishes modules and items, hides drafts from students and tracks views", async () => {
    const o = await offering();
    const t = await as("setter");
    const m = await saveModule(t, o.id, null, { title: "Unit 1 — Algorithms", isPublished: true });
    const page = await saveItem(t, m.id, null, { kind: "PAGE", title: "Reading guide", body: "Read chapter 1.", isPublished: true });
    const draft = await saveItem(t, m.id, null, { kind: "LINK", title: "Draft link", url: "https://example.org/x", isPublished: false });
    await expect(saveItem(t, m.id, null, { kind: "LINK", title: "Bad", url: "javascript:alert(1)" })).rejects.toThrow();
    const file = await uploadMaterial(t, m.id, form({ file: pdf("slides.pdf"), title: "Slides", isPublished: "true" }));
    expect(file.kind).toBe("FILE");
    await expect(uploadMaterial(t, m.id, form({ file: new File(["<script>"], "x.html") }))).rejects.toThrow(/Upload a PDF/);

    const st = await as("student");
    await openItem(st, page.id);
    await openItem(st, page.id);
    await expect(openItem(st, draft.id)).rejects.toThrow(/not found/);
    const view = await db.learningItemView.findFirstOrThrow({ where: { itemId: page.id } });
    expect(view.views).toBe(2);
  });

  it("notifies students of announcements", async () => {
    const o = await offering();
    await postAnnouncement(await as("setter"), o.id, { title: "CAT II syllabus", body: "Units 1 to 3." });
    const u = await db.user.findUniqueOrThrow({ where: { email: "student@example.edu" } });
    expect(await db.notification.count({ where: { userId: u.id, type: "lms.announcement" } })).toBeGreaterThan(0);
  });
});

describe("assignments", () => {
  it("accepts submissions in the window, applies late penalties, grades, releases and keeps content immutable", async () => {
    const o = await offering();
    const t = await as("setter");
    const now = Date.now();
    const a = await saveAssignment(t, o.id, null, { title: "Sorting analysis", instructions: "Compare three sorting algorithms.", maxMarks: 20, dueAt: new Date(now - hour), closesAt: new Date(now + hour), latePenaltyPercent: 10, maxAttempts: 1, allowText: true, allowFiles: true, maxFiles: 2, isPublished: true });
    const st = await as("student");
    await expect(submitAssignment(st, a.id, form({}))).rejects.toThrow(/Write an answer/);
    await expect(submitAssignment(st, a.id, form({ files: [pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf")] }))).rejects.toThrow(/at most 2/);
    const sub = await submitAssignment(st, a.id, form({ text: "Merge sort is stable.", files: pdf("report.pdf") }));
    expect(sub.isLate).toBe(true);
    expect(sub.penalty).toBe(0.1);
    await expect(submitAssignment(st, a.id, form({ text: "Second try" }))).rejects.toThrow(/all 1 attempt/);

    await expect(gradeSubmission(t, sub.id, { marks: 25, status: "GRADED" })).rejects.toThrow(/cannot exceed/);
    const g = await gradeSubmission(t, sub.id, { marks: 18, feedback: "Good comparison.", status: "GRADED" });
    expect(g.finalMarks).toBe(16.2);
    await releaseGrades(t, a.id);
    // The student's work cannot be altered, even by the database's owner.
    await expect(db.submission.update({ where: { id: sub.id }, data: { text: "changed" } })).rejects.toThrow(/cannot be changed/);
    await expect(db.submission.delete({ where: { id: sub.id } })).rejects.toThrow(/cannot be deleted/);

    // Returning for rework allows one more attempt.
    await gradeSubmission(t, sub.id, { status: "RETURNED", feedback: "Add complexity analysis." });
    const second = await submitAssignment(st, a.id, form({ text: "Now with Big-O analysis." }));
    expect(second.attempt).toBe(2);
  });

  it("refuses submissions after the window", async () => {
    const o = await offering();
    const a = await saveAssignment(await as("setter"), o.id, null, { title: "Closed task", instructions: "Already over.", maxMarks: 10, dueAt: new Date(Date.now() - 2 * hour), isPublished: true });
    await expect(submitAssignment(await as("student"), a.id, form({ text: "Too late" }))).rejects.toThrow(/late submissions are not accepted/);
  });
});

describe("quizzes & gradebook", () => {
  it("runs a timed, auto-graded quiz and feeds the gradebook into internal marks", async () => {
    const o = await offering();
    const t = await as("setter");
    const now = Date.now();
    const quiz = await saveQuiz(t, o.id, null, { title: "Quiz 1", opensAt: new Date(now - hour), closesAt: new Date(now + hour), timeLimitMinutes: 20, reviewPolicy: "AFTER_SUBMIT" });
    await expect(saveQuiz(t, o.id, quiz.id, { title: "Quiz 1", opensAt: new Date(now - hour), closesAt: new Date(now + hour), isPublished: true })).rejects.toThrow(/Add questions/);
    const q1 = await saveQuestion(t, quiz.id, null, { type: "SINGLE", prompt: "Worst case of quicksort?", options: [{ id: "a", text: "O(n log n)" }, { id: "b", text: "O(n²)" }], answer: { correct: ["b"] }, marks: 2 });
    const q2 = await saveQuestion(t, quiz.id, null, { type: "NUMERIC", prompt: "Comparisons to find max of 8 items?", answer: { value: 7 }, marks: 3 });
    await expect(saveQuestion(t, quiz.id, null, { type: "SINGLE", prompt: "Broken", options: [{ id: "a", text: "x" }, { id: "b", text: "y" }], answer: { correct: ["z"] }, marks: 1 })).rejects.toThrow(/correct option/);
    await saveQuiz(t, o.id, quiz.id, { title: "Quiz 1", opensAt: new Date(now - hour), closesAt: new Date(now + hour), timeLimitMinutes: 20, reviewPolicy: "AFTER_SUBMIT", isPublished: true });

    const st = await as("student");
    const at = await startAttempt(st, quiz.id);
    expect((await startAttempt(st, quiz.id)).id).toBe(at.id); // resumes
    expect(at.deadlineAt.getTime() - at.startedAt.getTime()).toBe(20 * 60_000);
    await saveAnswers(st, at.id, { [q1.id]: "b" });
    const done = await submitAttempt(st, at.id, { [q2.id]: "7" });
    expect(done.score).toBe(5);
    await expect(startAttempt(st, quiz.id)).rejects.toThrow(/all 1 attempt/);
    await expect(saveQuestion(t, quiz.id, q1.id, { type: "SINGLE", prompt: "Changed", options: [{ id: "a", text: "x" }, { id: "b", text: "y" }], answer: { correct: ["a"] }, marks: 2 })).rejects.toThrow(/locked/);
    await expect(db.quizAttempt.update({ where: { id: at.id }, data: { answers: {} } })).rejects.toThrow(/cannot be changed/);

    // Expired attempts are submitted with whatever was saved.
    const other = await db.quizAttempt.create({ data: { quizId: quiz.id, studentId: (await db.courseRegistration.findFirstOrThrow({ where: { offeringId: o.id, student: { email: { not: "student@example.edu" } } } })).studentId, attemptNo: 1, startedAt: new Date(now - hour), deadlineAt: new Date(now - 30 * 60_000), questionOrder: [q1.id, q2.id], answers: { [q1.id]: "b" }, maxScore: 5 } });
    const gb = await gradebook(t, o.id);
    expect((await db.quizAttempt.findUniqueOrThrow({ where: { id: other.id } })).score).toBe(2);
    const col = gb.columns.find((c) => c.key === `q:${quiz.id}`)!;
    expect(col.max).toBe(5);
    const me = gb.rows.find((r) => r.student.id === done.studentId)!;
    expect(me.cells[col.key]).toBe(5);
    await expect(gradebook(st, o.id)).rejects.toThrow();

    const comp = await db.assessmentComponent.findFirstOrThrow({ where: { offeringId: o.id, name: "Assignment" } });
    const r = await transferToComponent(t, o.id, { column: col.key, componentId: comp.id });
    expect(r.transferred).toBe(2);
    const mark = await db.mark.findUniqueOrThrow({ where: { componentId_studentId: { componentId: comp.id, studentId: done.studentId } } });
    expect(mark.marks).toBe(10); // 5/5 scaled to 10
  });
});
