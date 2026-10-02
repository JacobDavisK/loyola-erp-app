/**
 * Teaching-tools demo data: a proctored quiz, course-exit and teacher-feedback surveys with anonymous
 * responses (so OBE has indirect attainment), an open student satisfaction survey, and an alumni survey on a
 * public link. No external LTI tool is registered: tools must be real services the institution subscribes to.
 */
import { createHmac } from "node:crypto";
import type { SeedContext } from "./seed-erp";

const SSS = ["syllabus", "preparation", "communication", "approach", "evaluation", "mentoring", "ict", "opportunities"];
const TEACHER = ["prepared", "clarity", "pace", "doubts", "assessment", "punctual"];

export async function seedTeaching(s: SeedContext, r: () => number) {
  const { db } = s;
  console.log("› teaching tools: proctored quiz, surveys and responses");
  const day = 86_400_000;
  const now = s.now.getTime();
  const secret = process.env.APP_SECRET ?? "dev-secret";
  const respondent = (surveyId: string, who: string) => createHmac("sha256", secret).update(`survey:${surveyId}:${who}`).digest("hex");
  const likert = (bias: number) => Math.max(1, Math.min(5, Math.round(3 + bias + (r() - 0.5) * 2.4)));

  // One quiz uses basic proctoring.
  const quiz = await db.quiz.findFirst({ where: { isPublished: true }, orderBy: { opensAt: "desc" } });
  if (quiz) await db.quiz.update({ where: { id: quiz.id }, data: { proctoring: "BASIC" } });

  // Course-exit and teacher-feedback surveys for the current term's classes that have students.
  const offerings = await db.courseOffering.findMany({
    where: { term: { isCurrent: true }, registrations: { some: { status: "REGISTERED" } } },
    include: { course: { select: { code: true, outcomes: { orderBy: { code: "asc" }, select: { id: true, code: true, description: true } } } }, registrations: { where: { status: "REGISTERED" }, select: { student: { select: { userId: true, id: true } } } }, instructors: { select: { userId: true } } },
    take: 6,
  });
  const author = s.users["hod.cs"].id;
  // The demo student is left free to answer the surveys themselves.
  const demo = (await db.user.findUnique({ where: { email: "student@example.edu" }, select: { id: true } }))?.id;
  for (const [k, o] of offerings.entries()) {
    const label = `${o.course.code}-${o.section}`;
    const teacher = await db.survey.create({
      data: { title: `Teacher feedback — ${label}`, kind: "TEACHER_FEEDBACK", audience: "CLASS", offeringId: o.id, anonymous: true, status: k < 3 ? "OPEN" : "DRAFT", opensAt: new Date(now - 5 * day), closesAt: new Date(now + 9 * day), createdById: author,
        questions: [...TEACHER.map((id) => ({ id, type: "LIKERT", text: { prepared: "The teacher came prepared for classes.", clarity: "The teacher explained concepts clearly.", pace: "The pace of teaching was right for me.", doubts: "The teacher encouraged questions and cleared doubts.", assessment: "Assessments were fair and returned with useful feedback.", punctual: "Classes started and ended on time." }[id] })), { id: "best", type: "TEXT", text: "What did you like most about this course?" }, { id: "improve", type: "TEXT", text: "What should be improved?" }] },
    });
    if (o.course.outcomes.length) {
      const exit = await db.survey.create({
        data: { title: `Course exit survey — ${label}`, kind: "COURSE_EXIT", audience: "CLASS", offeringId: o.id, anonymous: true, status: k < 3 ? "OPEN" : "DRAFT", opensAt: new Date(now - 5 * day), closesAt: new Date(now + 9 * day), createdById: author,
          questions: [...o.course.outcomes.map((c) => ({ id: c.code.toLowerCase(), type: "LIKERT", text: `I am able to: ${c.description.replace(/\.$/, "")}.`, outcomeId: c.id })), { id: "comments", type: "TEXT", text: "Anything else about this course?" }] },
      });
      if (k < 3) {
        const answering = o.registrations.filter((x) => x.student.userId !== demo).slice(0, Math.max(6, Math.floor(o.registrations.length * 0.7)));
        for (const reg of answering) {
          const answers: Record<string, number | string> = {};
          o.course.outcomes.forEach((c, i) => { answers[c.code.toLowerCase()] = likert(i === 0 ? 0.9 : i === o.course.outcomes.length - 1 ? -0.4 : 0.4); });
          await db.surveyResponse.create({ data: { surveyId: exit.id, respondentHash: respondent(exit.id, reg.student.userId ?? reg.student.id), answers, submittedAt: new Date(now - Math.floor(r() * 4) * day) } });
        }
      }
    }
    if (k < 3) {
      const answering = o.registrations.filter((x) => x.student.userId !== demo).slice(0, Math.max(6, Math.floor(o.registrations.length * 0.6)));
      const comments = ["Lab sessions were the most useful part.", "Clear examples in every class.", "More practice problems before the internal test would help.", "Notes on the course page were very helpful.", ""];
      for (const [i, reg] of answering.entries()) {
        const answers: Record<string, number | string> = Object.fromEntries(TEACHER.map((q) => [q, likert(q === "pace" ? -0.3 : 0.6)]));
        if (i % 3 === 0) answers.best = comments[i % comments.length];
        if (i % 4 === 1) answers.improve = "More practice problems before the internal test would help.";
        await db.surveyResponse.create({ data: { surveyId: teacher.id, respondentHash: respondent(teacher.id, reg.student.userId ?? reg.student.id), answers } });
      }
    }
  }

  // Student satisfaction survey (NAAC), open to all students, with some responses.
  const sss = await db.survey.create({
    data: { title: "Student Satisfaction Survey 2026", kind: "STUDENT_SATISFACTION", audience: "STUDENTS", anonymous: true, status: "OPEN", opensAt: new Date(now - 10 * day), closesAt: new Date(now + 20 * day), createdById: s.users.iqac.id,
      questions: [...SSS.map((id) => ({ id, type: "LIKERT", text: { syllabus: "The syllabus was covered in the classes.", preparation: "Teachers prepared well for the classes.", communication: "Teachers communicated clearly.", approach: "The teaching approach helped me learn.", evaluation: "Internal evaluation was fair and transparent.", mentoring: "My mentor helped me with academic and personal concerns.", ict: "Teachers used ICT tools (the learning platform, videos, quizzes) effectively.", opportunities: "The institution gives opportunities to learn and grow beyond the classroom." }[id] })), { id: "suggestions", type: "TEXT", text: "Suggestions to improve the teaching–learning process." }] },
  });
  const students = await db.student.findMany({ where: { status: "ACTIVE", user: { email: { not: "student@example.edu" } } }, select: { id: true, userId: true }, take: 40 });
  for (const st of students) await db.surveyResponse.create({ data: { surveyId: sss.id, respondentHash: respondent(sss.id, st.userId ?? st.id), answers: Object.fromEntries(SSS.map((q) => [q, likert(q === "opportunities" ? -0.2 : 0.5)])) } });

  // Alumni survey on a public link (the link is shown on the survey's page).
  const alumni = await db.survey.create({
    data: { title: "Alumni feedback on the curriculum", kind: "ALUMNI", audience: "PUBLIC_LINK", anonymous: false, status: "OPEN", opensAt: new Date(now - 2 * day), closesAt: new Date(now + 30 * day), createdById: s.users.iqac.id,
      questions: [{ id: "relevance", type: "LIKERT", text: "The curriculum was relevant to my work." }, { id: "skills", type: "LIKERT", text: "The programme gave me the skills employers expect." }, { id: "sector", type: "CHOICE", text: "Where do you work?", options: ["Industry", "Government", "Higher studies", "Entrepreneur", "Other"] }, { id: "advice", type: "TEXT", text: "What should we add to the curriculum?" }] },
  });
  const token = createHmac("sha256", secret).update(`survey-link:${alumni.id}`).digest("base64url").slice(0, 24);
  const { createHash } = await import("node:crypto");
  await db.survey.update({ where: { id: alumni.id }, data: { publicTokenHash: createHash("sha256").update(token).digest("hex") } });
}
