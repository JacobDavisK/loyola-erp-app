/**
 * Student-success demo data: faculty mentors for every active student, mentoring meetings, a knowledge
 * base for the assistant, course material and quiz questions tagged with course outcomes, and an initial
 * early-warning run for the current term (the worker recomputes it twice a day).
 */
import type { Prisma } from "../src/generated/prisma/client";
import { assessRisk, DEFAULT_RISK_POLICY } from "../src/lib/domain/success";
import type { SeedContext } from "./seed-erp";

export async function seedSuccess(s: SeedContext, r: () => number) {
  const { db } = s;
  console.log("› student success: mentors, meetings, knowledge base, outcome tags, early warning");
  const day = 86_400_000;
  const now = s.now.getTime();
  const today = new Date(new Date(now).toISOString().slice(0, 10));

  // ── B.Com curriculum (so the planner's what-if has a second programme to compare with) ──
  const bcomCourses = await db.course.findMany({ where: { programId: s.prog.BCOM }, select: { id: true, code: true, semester: { select: { number: true } } } });
  if (bcomCourses.length) {
    const cur = await db.curriculum.create({ data: { programId: s.prog.BCOM, regulationId: s.regulationId, version: 1, name: "B.Com (LOCF 2023)", totalCredits: 30, minCgpa: 5, status: "ACTIVE" } });
    await db.curriculumCourse.createMany({ data: bcomCourses.map((c) => ({ curriculumId: cur.id, courseId: c.id, semesterNumber: c.semester.number, category: "MANDATORY" as const })) });
    await db.batch.updateMany({ where: { programId: s.prog.BCOM }, data: { curriculumId: cur.id } });
  }

  // ── Mentors ──
  const pools: Record<string, string[]> = { CS: ["faculty.cs1", "faculty.cs2", "setter", "setter2"], COM: ["faculty.com1", "setter3", "setter4"] };
  const students = await db.student.findMany({ where: { deletedAt: null, status: { in: ["ACTIVE", "ON_LEAVE"] } }, orderBy: { studentNo: "asc" }, select: { id: true, userId: true, department: { select: { code: true } } } });
  const counters: Record<string, number> = {};
  const mentorOf = new Map<string, string>();
  for (const st of students) {
    const pool = pools[st.department.code];
    if (!pool) continue;
    const i = (counters[st.department.code] = (counters[st.department.code] ?? -1) + 1);
    const mentor = s.users[pool[i % pool.length]].id;
    mentorOf.set(st.id, mentor);
    await db.mentorAssignment.create({ data: { studentId: st.id, mentorId: mentor, startsOn: new Date(today.getTime() - 120 * day), assignedById: s.users["hod.cs"].id } });
  }

  // ── Meetings for the demo student and a few others ──
  const demo = await db.student.findFirst({ where: { user: { email: "student@example.edu" } }, select: { id: true } });
  const meetingFor = async (studentId: string, daysAgo: number, summary: string, items: string[], privateNotes: string | null, followUp: number | null) => {
    const mentorId = mentorOf.get(studentId);
    if (!mentorId) return;
    await db.mentorMeeting.create({ data: { studentId, mentorId, heldOn: new Date(now - daysAgo * day), mode: daysAgo % 2 ? "IN_PERSON" : "ONLINE", summary, actionItems: items.map((text, k) => ({ text, done: k === 0 && daysAgo > 30 })), privateNotes, followUpOn: followUp === null ? null : new Date(today.getTime() + followUp * day) } });
  };
  if (demo) {
    await meetingFor(demo.id, 60, "Start-of-term check-in. Discussed course load and the plan to take an NPTEL course in Python alongside the semester.", ["Register for the NPTEL Python course", "Attend the data-structures lab regularly"], "Quiet in class; prefers written feedback.", null);
    await meetingFor(demo.id, 12, "Reviewed internal test 1. Struggled with linked lists; agreed on extra practice and a session with the course teacher.", ["Solve the linked-list exercise set from the course page", "Meet Dr. Das during office hours"], null, 10);
  }
  for (const st of students.slice(5, 25)) if (r() < 0.5) await meetingFor(st.id, Math.floor(5 + r() * 50), "Routine mentoring meeting: attendance, internal marks and plans for the semester were discussed.", ["Keep attendance above 75%"], null, r() < 0.3 ? -2 : null);

  // ── Knowledge base ──
  const author = s.users.uniadmin.id;
  const articles: [string, string, string[], string, "ALL" | "STUDENT" | "STAFF"][] = [
    ["How to pay your fees", "Fees", ["fees", "payment", "receipt", "invoice"], "Fees are invoiced each term and shown under **My studies → Fees**.\n\n- Pay online from the invoice page when online payment is enabled, or at the accounts counter by cash, card, cheque or demand draft.\n- A receipt is issued immediately and appears under Fees → Receipts.\n- A late fee may apply after the due date printed on the invoice.\n- If you cannot pay on time, ask your mentor about instalments or apply for a concession through the department.", "STUDENT"],
    ["Applying for revaluation or retotalling", "Examinations", ["revaluation", "retotalling", "marks", "results"], "After results are published you may apply for **retotalling** (recounting of marks) or **revaluation** (re-marking by another examiner) from **Results**, within the window shown on the results page.\n\n- A fee applies per course.\n- Your marks may go up, down or stay the same; the revised result replaces the earlier one.\n- You are notified when the revaluation is complete.", "STUDENT"],
    ["Getting a bonafide or other certificate", "Certificates", ["bonafide", "certificate", "transcript", "migration"], "Request bonafide, course-completion, migration and transfer certificates from **Results → Certificates**. Requests are approved by the Registrar's office, usually within three working days. Every certificate carries a QR code that anyone can scan to verify it online.", "STUDENT"],
    ["Attendance rules and condonation", "Academics", ["attendance", "condonation", "shortage", "medical"], "You need at least **75%** attendance in each course to sit the end-semester examination.\n\n- Between 65% and 75% the shortage can be condoned once with a valid reason (for example, a medical certificate) and a condonation fee.\n- Below 65% you must repeat the course.\n- Approved on-duty and medical leave is not counted against you. Check your standing any time under **Attendance**.", "STUDENT"],
    ["Hall tickets and examination rules", "Examinations", ["hall ticket", "exam", "admit card", "malpractice"], "Hall tickets are issued under **Examinations** once you are eligible (attendance, fees and registration). Bring the hall ticket and your college ID to every examination. Arrive 30 minutes early; electronic devices are not allowed in the hall. Any malpractice is reported to the examination committee.", "STUDENT"],
    ["Hostel rules and out-pass", "Hostel", ["hostel", "outpass", "warden", "room"], "Hostel gates close at 9:30 pm. To stay out overnight or leave the campus for a weekend, apply for an **out-pass** in advance; your warden approves it and your guardian is informed. Visitors are allowed in the visitors' lounge between 4 pm and 7 pm.", "STUDENT"],
    ["Library borrowing", "Library", ["library", "books", "fine", "renew"], "Students may borrow up to three books for 14 days and renew each twice unless someone has reserved it. Overdue books attract a fine of ₹2 per day, which is added to your fees. Reserve a book that is out on loan from the catalogue and you will be told when it is ready.", "STUDENT"],
    ["Scholarships", "Fees", ["scholarship", "freeship", "financial aid"], "Open scholarships are listed under **Fees → Scholarships** with their eligibility rules. Apply before the closing date with the documents asked for. Approved scholarships are credited against your fee invoices.", "STUDENT"],
    ["APAAR ID and the Academic Bank of Credits", "Academics", ["apaar", "abc", "credits", "digilocker"], "Your APAAR ID (12 digits) is your Academic Bank of Credits account. Create it through DigiLocker, then enter it under **Credits & APAAR**; the office verifies it. Once verified, your credits are uploaded to ABC each time results are published, and your mark sheets and degree reach DigiLocker.", "STUDENT"],
    ["Raising a grievance", "Support", ["grievance", "complaint", "ragging", "ombudsperson"], "Raise academic or administrative grievances through the Helpdesk or with your mentor. Ragging and harassment can be reported confidentially to the Anti-Ragging Committee. If a grievance is not resolved within 15 days you may appeal to the Ombudsperson.", "ALL"],
    ["Mentoring", "Support", ["mentor", "advisor", "counselling"], "Every student has a faculty mentor. Meet your mentor at least twice a term; agreed action items appear under **Mentoring & support**, where you can also ask for help at any time — about studies, attendance, fees or anything else.", "STUDENT"],
    ["Recording mentoring meetings", "Staff guides", ["mentoring", "meeting", "early warning"], "Record each meeting under **Mentoring**. The summary and action items are shared with the student; private notes are seen only by you and student-success managers. High-risk students in your mentee list get a support case automatically.", "STAFF"],
  ];
  for (const [title, category, tags, body, audience] of articles) {
    await db.knowledgeArticle.create({ data: { slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), title, category, tags, body, audience, published: true, updatedById: author, createdAt: new Date(now - 90 * day) } });
  }

  // ── Outcome tags on course material and quiz questions ──
  const items = await db.learningItem.findMany({ select: { id: true, module: { select: { offering: { select: { course: { select: { outcomes: { select: { id: true }, orderBy: { code: "asc" } } } } } } } } } });
  for (const [k, it] of items.entries()) {
    const cos = it.module.offering.course.outcomes;
    if (!cos.length) continue;
    await db.learningItemOutcome.createMany({ data: [cos[k % cos.length], cos[(k + 1) % cos.length]].map((o) => ({ itemId: it.id, outcomeId: o.id })), skipDuplicates: true });
  }
  const questions = await db.quizQuestion.findMany({ select: { id: true, quiz: { select: { offering: { select: { course: { select: { outcomes: { select: { id: true }, orderBy: { code: "asc" } } } } } } } } } });
  for (const [k, q] of questions.entries()) {
    const cos = q.quiz.offering.course.outcomes;
    if (cos.length) await db.quizQuestion.update({ where: { id: q.id }, data: { outcomeId: cos[k % cos.length].id } });
  }

  // ── Early warning for the current term (attendance and internal marks; the job adds the other signals) ──
  const term = await db.academicTerm.findFirst({ where: { isCurrent: true } });
  if (!term) return;
  const regs = await db.courseRegistration.findMany({ where: { status: "REGISTERED", offering: { termId: term.id } }, select: { studentId: true, offeringId: true } });
  const byStudent = new Map<string, string[]>();
  for (const x of regs) (byStudent.get(x.studentId) ?? byStudent.set(x.studentId, []).get(x.studentId)!).push(x.offeringId);
  // A few students are struggling, so the early-warning views have something to show: they missed most
  // recent classes (attendance records changed to absent) and have stopped using the course pages.
  const strugglers = [...byStudent.keys()].sort().filter((_, i) => i % 9 === 4).slice(0, 7);
  for (const [k, studentId] of strugglers.entries()) {
    const recs = await db.attendanceRecord.findMany({ where: { studentId, meeting: { offeringId: { in: byStudent.get(studentId)! }, status: "HELD" } }, select: { id: true }, orderBy: { markedAt: "desc" } });
    const share = k < 4 ? 0.6 : 0.35;
    const ids = recs.filter((_, i) => i % 10 < share * 10).map((x) => x.id);
    if (ids.length) await db.attendanceRecord.updateMany({ where: { id: { in: ids } }, data: { mark: "ABSENT" } });
    if (k < 4) {
      // …and scored poorly in internal tests.
      const marks = await db.mark.findMany({ where: { studentId, marks: { not: null }, component: { offeringId: { in: byStudent.get(studentId)! }, kind: { not: "EXTERNAL" } } }, select: { id: true, component: { select: { maxMarks: true } } } });
      for (const m of marks) await db.mark.update({ where: { id: m.id }, data: { marks: Math.round(m.component.maxMarks * (0.2 + r() * 0.15) * 2) / 2 } });
    }
  }
  const struggling = new Set(strugglers);
  let n = 0;
  for (const [studentId, offerings] of byStudent) {
    const [att, marks] = await Promise.all([
      db.attendanceRecord.findMany({ where: { studentId, meeting: { offeringId: { in: offerings }, status: "HELD" } }, select: { mark: true } }),
      db.mark.findMany({ where: { studentId, component: { offeringId: { in: offerings }, kind: { not: "EXTERNAL" } }, marks: { not: null } }, select: { marks: true, component: { select: { maxMarks: true } } } }),
    ]);
    const counted = att.filter((a) => a.mark !== "EXCUSED");
    const present = counted.filter((a) => ["PRESENT", "LATE", "ON_DUTY", "MEDICAL"].includes(a.mark)).length;
    const max = marks.reduce((a, m) => a + m.component.maxMarks, 0);
    const res = assessRisk({
      attendancePercent: counted.length ? (present / counted.length) * 100 : null,
      internalPercent: max ? (marks.reduce((a, m) => a + (m.marks ?? 0), 0) / max) * 100 : null,
      activeFailures: 0, overdueAmount: 0, overdueDays: 0, daysInactive: struggling.has(studentId) ? 25 + Math.floor(r() * 20) : 3 + Math.floor(r() * 12), missedAssignments: struggling.has(studentId) ? 2 : r() < 0.15 ? 1 : 0,
    }, DEFAULT_RISK_POLICY);
    await db.studentRisk.create({ data: { studentId, termId: term.id, score: res.score, level: res.level, factors: res.factors as unknown as Prisma.InputJsonValue, computedAt: new Date(now - 3 * 3_600_000) } });
    if (res.level === "HIGH") {
      n++;
      await db.supportCase.create({
        data: {
          number: `SC/${new Date(now).getUTCFullYear()}/${String(n).padStart(5, "0")}`, studentId, source: "SYSTEM", level: "HIGH", summary: `Early warning: risk score ${res.score}`,
          reasons: res.factors.filter((f) => f.risk > 0).slice(0, 3).map((f) => `${f.label}: ${f.detail}`), assigneeId: mentorOf.get(studentId) ?? null, dueAt: new Date(now + 5 * day), createdAt: new Date(now - 2 * day),
        },
      });
    }
  }
  if (n) await db.numberSequence.create({ data: { key: "success.case", prefix: "SC/{YYYY}/", padding: 5, next: n + 1 } });
}
