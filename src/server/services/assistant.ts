import "server-only";
import { z } from "zod";
import { formatMoney } from "@/lib/domain/money";
import { aiProvider, extractJson, runAi } from "@/server/ai/gateway";
import { type AuthContext } from "@/server/auth/current";
import { db } from "@/server/db";
import { AppError, forbidden } from "@/server/errors";
import { currentTerm } from "@/server/services/academic-setup";
import { studentBalance } from "@/server/services/finance-core";
import { keywords, searchArticles } from "@/server/services/knowledge";
import { hasConsent } from "@/server/services/privacy";
import { getSetting } from "@/server/services/settings";

/**
 * Student assistant: answers questions about rules and procedures from the knowledge base and, when the
 * student has allowed it (optional "ai.assistant" consent), about their own attendance, fees, results and
 * deadlines.
 *
 * With an AI provider configured, the model writes the answer from that material only. Without one, the
 * assistant still works: it recognises common questions about the student's own records and returns the
 * best-matching knowledge-base articles — nothing is simulated.
 *
 * The assistant never acts on its own. It may propose an action (raise a helpdesk ticket, open a page);
 * the student confirms it in the interface, which calls the normal, permission-checked action.
 */

export interface AssistantAction {
  type: "ticket" | "link";
  label: string;
  href?: string;
  category?: string;
  subject?: string;
  description?: string;
}

export interface AssistantReply {
  mode: "ai" | "search";
  answer: string;
  sources: { title: string; slug: string }[];
  action: AssistantAction | null;
  usedRecords: boolean;
}

const LINKS: Record<string, { href: string; label: string }> = {
  attendance: { href: "/portal/attendance", label: "Open attendance" },
  fees: { href: "/portal/fees", label: "Open fees" },
  results: { href: "/portal/results", label: "Open results" },
  exams: { href: "/portal/exams", label: "Open examinations" },
  courses: { href: "/portal/courses", label: "Open my courses" },
  planner: { href: "/portal/planner", label: "Open the degree planner" },
  support: { href: "/portal/support", label: "Open mentoring & support" },
  credits: { href: "/portal/credits", label: "Open credits & APAAR" },
};

/** A compact, identifier-free summary of the student's own records for the current term. */
export async function ownRecordSummary(studentId: string) {
  const term = await currentTerm();
  const [student, regs, balance, terms, deadlines, mentor] = await Promise.all([
    db.student.findUniqueOrThrow({ where: { id: studentId }, select: { currentSemester: true, status: true, program: { select: { name: true } } } }),
    term ? db.courseRegistration.findMany({ where: { studentId, status: "REGISTERED", offering: { termId: term.id } }, select: { offeringId: true, offering: { select: { course: { select: { code: true, title: true } } } } } }) : [],
    db.$transaction((tx) => studentBalance(tx, studentId)),
    db.termResult.findMany({ where: { studentId, isCurrent: true, publishedAt: { not: null } }, orderBy: { createdAt: "desc" }, take: 1, select: { sgpa: true, cgpa: true, creditsEarned: true } }),
    db.assignment.findMany({ where: { isPublished: true, dueAt: { gt: new Date() }, offering: { registrations: { some: { studentId, status: "REGISTERED" } } } }, orderBy: { dueAt: "asc" }, take: 5, select: { title: true, dueAt: true, offering: { select: { course: { select: { code: true } } } }, submissions: { where: { studentId }, select: { id: true }, take: 1 } } }),
    db.mentorAssignment.findFirst({ where: { studentId, endsOn: null }, select: { mentor: { select: { name: true } } } }),
  ]);
  const attendance = [];
  for (const r of regs) {
    const recs = await db.attendanceRecord.findMany({ where: { studentId, meeting: { offeringId: r.offeringId, status: "HELD" } }, select: { mark: true } });
    const present = recs.filter((x) => x.mark === "PRESENT" || x.mark === "LATE" || x.mark === "ON_DUTY").length;
    attendance.push({ course: `${r.offering.course.code} ${r.offering.course.title}`, held: recs.length, percent: recs.length ? Math.round((present / recs.length) * 1000) / 10 : null });
  }
  return {
    programme: student.program.name,
    semester: student.currentSemester,
    status: student.status,
    term: term?.name ?? null,
    attendance,
    fees: { outstanding: formatMoney(balance.outstanding), overdueInvoices: balance.overdue },
    latestResult: terms[0] ?? null,
    upcomingAssignments: deadlines.map((d) => ({ course: d.offering.course.code, title: d.title, due: d.dueAt.toISOString().slice(0, 16).replace("T", " "), submitted: d.submissions.length > 0 })),
    mentor: mentor?.mentor.name ?? null,
  };
}

type Summary = Awaited<ReturnType<typeof ownRecordSummary>>;

/** Deterministic answers for common questions about one's own records (used without an AI provider). */
function intentAnswer(q: string, s: Summary | null): { text: string; link: keyof typeof LINKS } | null {
  const t = q.toLowerCase();
  const has = (...w: string[]) => w.some((x) => t.includes(x));
  if (has("attendance", "absent", "shortage", "condon")) {
    if (!s) return { text: "Your attendance for each class is on the Attendance page.", link: "attendance" };
    if (!s.attendance.length) return { text: "You are not registered in any class this term yet.", link: "attendance" };
    const lines = s.attendance.map((a) => `• ${a.course}: ${a.percent === null ? "no classes held yet" : `${a.percent}% of ${a.held} class(es)`}`);
    return { text: `Your attendance this term:\n${lines.join("\n")}`, link: "attendance" };
  }
  if (has("fee", "fees", "due", "pay", "payment", "balance", "invoice")) {
    if (!s) return { text: "Your invoices, payments and receipts are on the Fees page.", link: "fees" };
    return { text: `You owe ${s.fees.outstanding} in total${s.fees.overdueInvoices ? `; ${s.fees.overdueInvoices} invoice(s) are past their due date` : ", and nothing is overdue"}.`, link: "fees" };
  }
  if (has("result", "grade", "cgpa", "sgpa", "gpa", "marks")) {
    if (!s) return { text: "Your published results are on the Results page.", link: "results" };
    return { text: s.latestResult ? `Your latest published result: SGPA ${s.latestResult.sgpa ?? "—"}, CGPA ${s.latestResult.cgpa ?? "—"}, ${s.latestResult.creditsEarned} credits earned in that term.` : "No results have been published for you yet.", link: "results" };
  }
  if (has("assignment", "deadline", "submit", "homework")) {
    if (!s) return { text: "Your assignments and quizzes are in My courses.", link: "courses" };
    return { text: s.upcomingAssignments.length ? `Coming up:\n${s.upcomingAssignments.map((a) => `• ${a.course} — ${a.title}, due ${a.due} UTC${a.submitted ? " (submitted)" : ""}`).join("\n")}` : "You have no upcoming assignment deadlines.", link: "courses" };
  }
  if (has("mentor", "advisor", "adviser")) return { text: s?.mentor ? `Your mentor is ${s.mentor}. You can see your meetings and action items under Mentoring & support.` : "Your mentor and meetings are shown under Mentoring & support.", link: "support" };
  if (has("exam", "hall ticket", "admit card")) return { text: "Your examination registrations and hall tickets are on the Examinations page.", link: "exams" };
  if (has("plan", "graduate", "elective")) return { text: "The degree planner shows the courses you still need and checks your plan semester by semester.", link: "planner" };
  if (has("apaar", "abc", "credit transfer", "swayam", "nptel", "mooc", "exit")) return { text: "Your APAAR ID, transfer credits and NEP exit options are on the Credits & APAAR page.", link: "credits" };
  return null;
}

const askSchema = z.object({
  message: z.string().trim().min(2).max(1000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(12).default([]),
});

export async function askAssistant(ctx: AuthContext, raw: unknown): Promise<AssistantReply> {
  const studentId = ctx.subject.studentId;
  if (!studentId) throw forbidden("The assistant is available in the student portal.");
  const v = askSchema.parse(raw);
  const [articles, consent, ai] = await Promise.all([searchArticles(ctx, v.message, 4), hasConsent(ctx.user.id, "ai.assistant"), getSetting("ai")]);
  const sources = articles.map((a) => ({ title: a.title, slug: a.slug }));
  const provider = aiProvider();

  if (!provider || !ai.enabled || !ai.studentAssistant) {
    const summary = consent ? await ownRecordSummary(studentId) : null;
    const intent = intentAnswer(v.message, summary);
    if (intent) return { mode: "search", answer: intent.text, sources, action: { type: "link", ...LINKS[intent.link] }, usedRecords: !!summary };
    if (articles.length) {
      const top = articles[0];
      const excerpt = top.body.length > 600 ? `${top.body.slice(0, 600).trimEnd()}…` : top.body;
      return { mode: "search", answer: `From "${top.title}":\n\n${excerpt}`, sources, action: null, usedRecords: false };
    }
    return {
      mode: "search",
      answer: "I could not find an answer to that. The helpdesk can help — I have drafted a ticket you can send.",
      sources: [],
      action: { type: "ticket", label: "Raise a helpdesk ticket", category: "academic", subject: v.message.slice(0, 120), description: v.message },
      usedRecords: false,
    };
  }

  const summary = consent ? await ownRecordSummary(studentId) : null;
  const system = [
    "You are the student assistant of a university. Answer the student's question briefly and accurately, in plain language.",
    "Use ONLY the knowledge-base articles and the student's record summary below. If they do not contain the answer, say so and suggest raising a helpdesk ticket. Never invent rules, dates, amounts or marks.",
    summary ? "The record summary is the student's own data, shared with their consent." : "The student has not allowed the assistant to read their records; if the question needs them, explain that they can allow it under Privacy & consent, or point them to the right page.",
    'Reply with ONE JSON object: {"answer": string, "action": null | {"type": "ticket", "category": "academic"|"examination"|"fees"|"it"|"hostel"|"other", "subject": string, "description": string} | {"type": "link", "page": "attendance"|"fees"|"results"|"exams"|"courses"|"planner"|"support"|"credits"}}.',
    "Propose a ticket only when the student needs a person to act. Propose a link when a page shows what they asked about.",
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
    `Knowledge base: ${JSON.stringify(articles.map((a) => ({ title: a.title, body: a.body.slice(0, 2500) })))}`,
    summary ? `Record summary: ${JSON.stringify(summary)}` : "",
  ].join("\n");
  const text = await runAi(ctx, "studentAssistant", { system, user: v.message, history: v.history, maxTokens: 700, temperature: 0.2 });
  const parsed = z.object({
    answer: z.string().min(1).max(4000),
    action: z.union([
      z.null(),
      z.object({ type: z.literal("ticket"), category: z.string().max(30), subject: z.string().max(200), description: z.string().max(4000) }),
      z.object({ type: z.literal("link"), page: z.enum(["attendance", "fees", "results", "exams", "courses", "planner", "support", "credits"]) }),
    ]).optional(),
  }).safeParse(extractJson(text));
  if (!parsed.success) throw new AppError("The assistant's reply could not be read. Try asking again.", "AI_FORMAT", 422);
  const a = parsed.data.action ?? null;
  const action: AssistantAction | null = !a ? null : a.type === "link" ? { type: "link", ...LINKS[a.page] } : { type: "ticket", label: "Raise this helpdesk ticket", category: a.category, subject: a.subject, description: a.description };
  return { mode: "ai", answer: parsed.data.answer, sources, action, usedRecords: !!summary };
}

export const suggestedQuestions = ["What is my attendance this term?", "How much fee do I owe?", "How do I apply for revaluation?", "When are my assignments due?", "How do I get a bonafide certificate?"];
export { keywords };
