import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { QuizTaker, StartQuizButton, type TakerQuestion } from "@/features/lms/controls";
import { reviewVisibility } from "@/lib/domain/lms";
import { fmtDateTimeZoned } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { getInstitution } from "@/server/services/directory";
import { getSetting } from "@/server/services/settings";
import { ProctorGuard, StartProctoredQuiz } from "@/features/teaching/controls";
import { courseSpace, finalizeExpiredAttempts } from "@/server/services/lms";

export const metadata: Metadata = { title: "Quiz" };

const POLICY = { AFTER_SUBMIT: "Your score and the answers are shown as soon as you submit.", AFTER_CLOSE: "Your score and the answers are shown after the quiz closes.", SCORE_ONLY: "Your score is shown after you submit.", NEVER: "Scores are not shown here." } as const;

function show(v: unknown, opts: { id: string; text: string }[] | null): string {
  if (v === undefined || v === null || v === "") return "—";
  if (Array.isArray(v)) return v.map((x) => opts?.find((o) => o.id === x)?.text ?? String(x)).join("; ") || "—";
  if (typeof v === "boolean") return v ? "True" : "False";
  return opts?.find((o) => o.id === v)?.text ?? String(v);
}

function keyOf(type: string, answer: Record<string, unknown>, opts: { id: string; text: string }[] | null): string {
  if (type === "SINGLE" || type === "MULTIPLE") return show(answer.correct, opts);
  if (type === "TRUE_FALSE") return answer.correct ? "True" : "False";
  if (type === "SHORT") return (answer.accepted as string[]).join(" / ");
  return `${answer.value}${answer.tolerance ? ` ± ${answer.tolerance}` : ""}`;
}

export default async function StudentQuizPage({ params }: { params: Promise<{ id: string; qid: string }> }) {
  const { id, qid } = await params;
  const ctx = await requirePageAuth("self.portal");
  const s = await courseSpace(ctx, id).catch(() => null);
  if (!s || s.role !== "student") notFound();
  const studentId = s.studentId!;
  await finalizeExpiredAttempts({ quizId: qid, studentId });
  const quiz = await db.quiz.findFirst({ where: { id: qid, offeringId: id, isPublished: true }, include: { questions: true, attempts: { where: { studentId }, orderBy: { attemptNo: "asc" } } } });
  if (!quiz) notFound();
  const { timezone: tz } = await getInstitution();
  const now = new Date();
  const open = quiz.attempts.find((a) => a.status === "IN_PROGRESS");
  const done = quiz.attempts.filter((a) => a.status === "SUBMITTED");
  const closed = now > quiz.closesAt;
  const vis = reviewVisibility(quiz.reviewPolicy, closed);
  const byId = new Map(quiz.questions.map((q) => [q.id, q]));
  const canStart = !open && now >= quiz.opensAt && !closed && quiz.attempts.length < quiz.maxAttempts;
  const proctor = quiz.proctoring !== "NONE" ? await getSetting("proctoring") : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow={`${s.offering.course.code} · quiz`} title={quiz.title} breadcrumbs={[{ label: s.offering.course.code, href: `/portal/courses/${id}?tab=quizzes` }, { label: quiz.title }]} />
      {open && proctor && quiz.proctoring !== "NONE" && <ProctorGuard attemptId={open.id} mode={quiz.proctoring} intervalMinutes={proctor.webcamIntervalMinutes} />}
      {open ? (
        // Only prompts and options are sent to the browser — never the answer key.
        <QuizTaker
          attemptId={open.id}
          deadline={open.deadlineAt.toISOString()}
          saved={open.answers as Record<string, unknown>}
          questions={(open.questionOrder as string[]).map((qId) => byId.get(qId)).filter((q): q is NonNullable<typeof q> => !!q).map((q): TakerQuestion => ({ id: q.id, type: q.type, prompt: q.prompt, options: q.options as TakerQuestion["options"], marks: q.marks }))}
        />
      ) : (
        <Section title="About this quiz">
          {quiz.instructions && <p className="mb-3 whitespace-pre-wrap text-sm">{quiz.instructions}</p>}
          <KeyValue items={[["Opens", fmtDateTimeZoned(quiz.opensAt, tz)], ["Closes", fmtDateTimeZoned(quiz.closesAt, tz)], ["Time limit", quiz.timeLimitMinutes ? `${quiz.timeLimitMinutes} minutes (the timer keeps running if you leave the page)` : "None"], ["Questions", `${quiz.questions.length} · ${quiz.questions.reduce((a, q) => a + q.marks, 0)} marks`], ["Attempts", `${quiz.attempts.length} of ${quiz.maxAttempts} used`], ["Review", POLICY[quiz.reviewPolicy]]]} />
          <div className="mt-4">
            {canStart && quiz.proctoring !== "NONE" ? <StartProctoredQuiz quizId={quiz.id} mode={quiz.proctoring} label={quiz.attempts.length ? "Start another attempt" : "Start quiz"} /> : canStart ? <StartQuizButton quizId={quiz.id} label={quiz.attempts.length ? "Start another attempt" : "Start quiz"} /> : <p className="text-sm text-muted-foreground">{now < quiz.opensAt ? "The quiz has not opened yet." : closed ? "The quiz has closed." : "You have used all your attempts."}</p>}
          </div>
        </Section>
      )}
      {done.map((a) => (
        <Section key={a.id} title={`Attempt ${a.attemptNo}`} description={`Submitted ${fmtDateTimeZoned(a.submittedAt, tz)}${vis.score ? ` · score ${a.score} / ${a.maxScore}` : ""}`}>
          {vis.answers ? (
            <ol className="space-y-3 text-sm">
              {(a.questionOrder as string[]).map((qId, i) => {
                const q = byId.get(qId);
                if (!q) return null;
                const got = (a.marksAwarded as Record<string, number> | null)?.[qId] ?? 0;
                const opts = q.options as { id: string; text: string }[] | null;
                return (
                  <li key={qId} className="rounded-lg border p-3">
                    <p className="whitespace-pre-wrap font-medium">{i + 1}. {q.prompt}</p>
                    <p className="mt-1">Your answer: <span className={cn(got >= q.marks ? "text-tone-success" : got > 0 ? "text-tone-warning" : "text-tone-danger")}>{show((a.answers as Record<string, unknown>)[qId], opts)}</span> · {got}/{q.marks}</p>
                    <p className="text-muted-foreground">Correct answer: {keyOf(q.type, q.answer as Record<string, unknown>, opts)}</p>
                    {q.explanation && <p className="mt-1 text-xs text-muted-foreground">{q.explanation}</p>}
                  </li>
                );
              })}
            </ol>
          ) : <p className="text-sm text-muted-foreground">{vis.score ? "Answers are not shown for this quiz." : POLICY[quiz.reviewPolicy]}</p>}
        </Section>
      ))}
    </div>
  );
}
