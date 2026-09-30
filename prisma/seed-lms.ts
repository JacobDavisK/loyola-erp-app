/**
 * LMS demo data for the current term's BCS301-A (taught by setter@example.edu, taken by student@example.edu):
 * two modules with pages and links, an announcement, a graded + released assignment, an open assignment,
 * and an open quiz. Other classes get a welcome module so every course space has something in it.
 */
import { applyPenalty, gradeAttempt } from "../src/lib/domain/lms";
import type { SeedContext } from "./seed-erp";

export async function seedLms(s: SeedContext, r: () => number) {
  const { db } = s;
  console.log("› LMS: course content, assignments, quizzes");
  const now = s.now.getTime();
  const day = 86_400_000;
  const offerings = await db.courseOffering.findMany({ where: { term: { isCurrent: true }, status: { not: "CANCELLED" } }, include: { course: true, instructors: true } });

  for (const o of offerings) {
    const author = o.instructors[0]?.userId;
    if (!author) continue;
    await db.courseModule.create({
      data: {
        offeringId: o.id, title: "Getting started", order: 0, isPublished: true,
        items: { create: [{ kind: "PAGE", title: "Course handbook", body: `Welcome to ${o.course.title}.\n\nAssessment: internal assessments (tests and assignments) and the end-semester examination.\nAttendance of at least 75% is required to sit the examination.\n\nOffice hours are posted on the department notice board.`, isPublished: true, order: 0, createdById: author }] },
      },
    });
  }

  const bcs = offerings.find((o) => o.course.code === "BCS301" && o.section === "A");
  if (!bcs) return;
  const teacher = bcs.instructors[0].userId;
  const m1 = await db.courseModule.create({
    data: {
      offeringId: bcs.id, title: "Unit 1 — Algorithm analysis", order: 1, isPublished: true,
      items: {
        create: [
          { kind: "PAGE", title: "Lecture notes: asymptotic notation", body: "Big-O gives an upper bound on growth, Big-Omega a lower bound and Big-Theta a tight bound.\n\nExample: 3n² + 5n + 2 is Θ(n²).\n\nPractice: find a tight bound for Σ(i=1..n) i.", isPublished: true, order: 0, createdById: teacher },
          { kind: "LINK", title: "Visualising sorting algorithms", url: "https://visualgo.net/en/sorting", body: "Step through the sorts we discussed in class.", isPublished: true, order: 1, createdById: teacher },
          { kind: "VIDEO", title: "Recorded lecture: recurrences", url: "https://www.youtube.com/results?search_query=master+theorem+recurrences", isPublished: true, order: 2, createdById: teacher },
        ],
      },
    },
  });
  await db.courseModule.create({
    data: { offeringId: bcs.id, title: "Unit 2 — Divide and conquer", order: 2, isPublished: false, items: { create: [{ kind: "PAGE", title: "Merge sort and quicksort (draft)", body: "Draft notes, not yet visible to students.", isPublished: false, order: 0, createdById: teacher }] } },
  });
  await db.courseAnnouncement.create({ data: { offeringId: bcs.id, title: "CAT I syllabus", body: "CAT I covers Unit 1 (asymptotic notation, recurrences). Bring your ID card.", authorId: teacher, createdAt: new Date(now - 2 * day) } });

  const regs = await db.courseRegistration.findMany({ where: { offeringId: bcs.id, status: "REGISTERED" }, select: { studentId: true }, orderBy: { studentId: "asc" } });
  const past = await db.assignment.create({
    data: {
      offeringId: bcs.id, moduleId: m1.id, title: "Problem set 1: growth of functions", instructions: "Solve problems 1–6 from the notes. Show each step. Upload a PDF or type your answers.",
      maxMarks: 20, dueAt: new Date(now - 7 * day), closesAt: new Date(now - 5 * day), latePenaltyPercent: 10, isPublished: true, publishedAt: new Date(now - 14 * day), gradesReleasedAt: new Date(now - 2 * day), createdById: teacher,
    },
  });
  for (const reg of regs) {
    const x = r();
    if (x < 0.1) continue; // did not submit
    const late = x < 0.2;
    const marks = Math.round((10 + r() * 10) * 2) / 2;
    const penalty = late ? 0.1 : 0;
    await db.submission.create({
      data: {
        assignmentId: past.id, studentId: reg.studentId, attempt: 1, text: "1) Θ(n²)  2) O(n log n)  3) Θ(2ⁿ) … (answers)", submittedAt: new Date(now - (late ? 6 : 8) * day), isLate: late, penalty,
        status: "GRADED", marks, finalMarks: applyPenalty(marks, penalty), feedback: marks > 16 ? "Clear and complete." : "Check the working for problems 4 and 5.", gradedById: teacher, gradedAt: new Date(now - 3 * day),
      },
    });
  }
  await db.assignment.create({
    data: {
      offeringId: bcs.id, moduleId: m1.id, title: "Mini-project: benchmarking sorts", instructions: "Implement insertion sort and merge sort, time them on inputs of size 10³–10⁶, and plot the results. Submit your report (PDF) and code (ZIP).",
      maxMarks: 25, dueAt: new Date(now + 10 * day), closesAt: new Date(now + 12 * day), latePenaltyPercent: 20, maxFiles: 3, isPublished: true, publishedAt: new Date(now - day), createdById: teacher,
    },
  });

  const quiz = await db.quiz.create({
    data: {
      offeringId: bcs.id, moduleId: m1.id, title: "Quiz 1: asymptotics", instructions: "Answer all questions. You have 15 minutes once you start.", opensAt: new Date(now - day), closesAt: new Date(now + 5 * day),
      timeLimitMinutes: 15, maxAttempts: 2, shuffleQuestions: true, reviewPolicy: "AFTER_SUBMIT", isPublished: true, createdById: teacher,
      questions: {
        create: [
          { order: 0, type: "SINGLE", prompt: "What is the worst-case running time of quicksort?", options: [{ id: "a", text: "O(n log n)" }, { id: "b", text: "O(n²)" }, { id: "c", text: "O(n)" }], answer: { correct: ["b"] }, marks: 2, explanation: "A consistently bad pivot gives n + (n−1) + … comparisons." },
          { order: 1, type: "MULTIPLE", prompt: "Which of these are O(n²)?", options: [{ id: "a", text: "5n + 3" }, { id: "b", text: "n²/2" }, { id: "c", text: "n³" }, { id: "d", text: "n log n" }], answer: { correct: ["a", "b", "d"], partial: true }, marks: 3 },
          { order: 2, type: "TRUE_FALSE", prompt: "Binary search requires the input to be sorted.", answer: { correct: true }, marks: 1 },
          { order: 3, type: "SHORT", prompt: "Name the theorem used to solve T(n) = aT(n/b) + f(n).", answer: { accepted: ["Master theorem", "Master's theorem", "master method"] }, marks: 2 },
          { order: 4, type: "NUMERIC", prompt: "How many comparisons does it take to find the maximum of 16 numbers?", answer: { value: 15, tolerance: 0 }, marks: 2 },
        ],
      },
    },
    include: { questions: true },
  });
  // A few students have already taken it.
  const qs = quiz.questions.map((q) => ({ id: q.id, type: q.type, marks: q.marks, answer: q.answer }));
  for (const reg of regs.slice(1, 8)) {
    const good = r() > 0.4;
    const answers: Record<string, unknown> = {};
    for (const q of quiz.questions) {
      answers[q.id] = q.type === "SINGLE" ? (good ? "b" : "a") : q.type === "MULTIPLE" ? (good ? ["a", "b"] : ["c"]) : q.type === "TRUE_FALSE" ? good : q.type === "SHORT" ? (good ? "master theorem" : "Big-O") : good ? 15 : 16;
    }
    const g = gradeAttempt(qs, answers);
    const started = new Date(now - 12 * 3_600_000);
    await db.quizAttempt.create({ data: { quizId: quiz.id, studentId: reg.studentId, attemptNo: 1, startedAt: started, deadlineAt: new Date(started.getTime() + 15 * 60_000), submittedAt: new Date(started.getTime() + 11 * 60_000), status: "SUBMITTED", questionOrder: quiz.questions.map((q) => q.id), answers: answers as object, marksAwarded: g.awarded, score: g.score, maxScore: g.maxScore } });
  }
}
