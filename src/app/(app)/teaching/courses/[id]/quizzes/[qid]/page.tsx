import { notFound } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section, StatCard } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/features/academic-ops/controls";
import { deleteQuestionAction, saveQuizAction } from "@/features/lms/actions";
import { QuestionEditor, type QuestionValue } from "@/features/lms/controls";
import { quizFields } from "@/features/lms/fields";
import { fmtDateTimeZoned, toZonedInput } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { getInstitution } from "@/server/services/directory";
import { courseSpace, finalizeExpiredAttempts } from "@/server/services/lms";

export const metadata: Metadata = { title: "Quiz" };

const TYPE = { SINGLE: "Single choice", MULTIPLE: "Multiple choice", TRUE_FALSE: "True / false", SHORT: "Short answer", NUMERIC: "Numeric" } as const;

function keyText(q: { type: keyof typeof TYPE; options: unknown; answer: unknown }) {
  const a = q.answer as Record<string, unknown>;
  const opts = (q.options as { id: string; text: string }[] | null) ?? [];
  if (q.type === "SINGLE" || q.type === "MULTIPLE") return (a.correct as string[]).map((c) => opts.find((o) => o.id === c)?.text ?? c).join("; ") + (a.partial ? " (partial credit)" : "");
  if (q.type === "TRUE_FALSE") return a.correct ? "True" : "False";
  if (q.type === "SHORT") return (a.accepted as string[]).join(" | ");
  return `${a.value}${a.tolerance ? ` ± ${a.tolerance}` : ""}`;
}

export default async function TeacherQuizPage({ params }: { params: Promise<{ id: string; qid: string }> }) {
  const { id, qid } = await params;
  const ctx = await requirePageAuth();
  const s = await courseSpace(ctx, id).catch(() => null);
  if (!s || s.role === "student") notFound();
  await finalizeExpiredAttempts({ quizId: qid });
  const quiz = await db.quiz.findFirst({ where: { id: qid, offeringId: id }, include: { questions: { orderBy: [{ order: "asc" }, { id: "asc" }] }, attempts: { orderBy: [{ studentId: "asc" }, { attemptNo: "asc" }], include: { student: { select: { studentNo: true, firstName: true, lastName: true } } } } } });
  if (!quiz) notFound();
  const edit = s.role === "teacher";
  const locked = quiz.attempts.length > 0;
  const { timezone: tz } = await getInstitution();
  const modules = await db.courseModule.findMany({ where: { offeringId: id }, select: { id: true, title: true } });
  const total = quiz.questions.reduce((a, q) => a + q.marks, 0);
  const submitted = quiz.attempts.filter((a) => a.status === "SUBMITTED");
  const avg = submitted.length ? Math.round((submitted.reduce((a, x) => a + (x.score ?? 0), 0) / submitted.length) * 100) / 100 : null;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${s.offering.course.code}-${s.offering.section}`}
        title={quiz.title}
        breadcrumbs={[{ label: "Course space", href: `/teaching/courses/${id}?tab=quizzes` }, { label: quiz.title }]}
        description={`${quiz.isPublished ? "Published" : "Draft"} · ${fmtDateTimeZoned(quiz.opensAt, tz)} – ${fmtDateTimeZoned(quiz.closesAt, tz)}${quiz.timeLimitMinutes ? ` · ${quiz.timeLimitMinutes} minutes` : ""} · ${quiz.maxAttempts} attempt(s)`}
        actions={edit && <FormDialog title="Quiz" columns={2} id={quiz.id} fields={quizFields(modules)} action={saveQuizAction.bind(null, id)} trigger={<Button size="sm" variant="outline">Settings</Button>}
          initial={{ title: quiz.title, instructions: quiz.instructions, moduleId: quiz.moduleId, opensAt: toZonedInput(quiz.opensAt, tz), closesAt: toZonedInput(quiz.closesAt, tz), timeLimitMinutes: quiz.timeLimitMinutes, maxAttempts: quiz.maxAttempts, reviewPolicy: quiz.reviewPolicy, shuffleQuestions: quiz.shuffleQuestions, isPublished: quiz.isPublished }} />}
      />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
        <StatCard label="Questions" value={quiz.questions.length} hint={`${total} marks`} />
        <StatCard label="Submitted attempts" value={submitted.length} />
        <StatCard label="Average score" value={avg === null ? "—" : `${avg} / ${total}`} />
      </div>
      <Section
        title="Questions"
        description={locked ? "Locked: students have attempted this quiz." : "Answer keys never leave the server; students only receive the questions."}
        actions={edit && !locked && <QuestionEditor quizId={quiz.id} trigger={<Button size="xs"><Plus /> Question</Button>} />}
        bodyClassName="p-0"
      >
        {quiz.questions.length === 0 ? <p className="px-5 py-4 text-sm text-muted-foreground">No questions yet.</p> : (
          <ol className="divide-y">
            {quiz.questions.map((q, i) => {
              const value: QuestionValue = { id: q.id, type: q.type, prompt: q.prompt, options: (q.options as { id: string; text: string }[] | null) ?? [], answer: q.answer as Record<string, unknown>, marks: q.marks, explanation: q.explanation ?? "", order: q.order };
              return (
                <li key={q.id} className="flex gap-3 px-5 py-3">
                  <span className="w-6 text-sm text-muted-foreground tabular">{i + 1}.</span>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="whitespace-pre-wrap">{q.prompt}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{TYPE[q.type]} · {q.marks} mark(s) · key: <span className="text-foreground">{keyText(q)}</span></p>
                  </div>
                  {edit && !locked && (
                    <div className="flex gap-1">
                      <QuestionEditor quizId={quiz.id} initial={value} trigger={<Button size="icon-xs" variant="ghost" aria-label="Edit question"><Pencil /></Button>} />
                      <ActionButton size="xs" variant="ghost" label="" ariaLabel="Delete question" icon={<Trash2 />} run={deleteQuestionAction.bind(null, q.id)} confirmText="Delete this question?" />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Section>
      <Section title="Attempts" bodyClassName="p-0">
        <DataTable head={[{ label: "Student" }, { label: "Attempt", className: "text-right" }, { label: "Started" }, { label: "Submitted" }, { label: "Score", className: "text-right" }]} empty="No attempts yet.">
          {quiz.attempts.map((a) => (
            <tr key={a.id}>
              <Td>{a.student.firstName} {a.student.lastName}<div className="font-mono text-[11px] text-muted-foreground">{a.student.studentNo}</div></Td>
              <Td className="text-right tabular">{a.attemptNo}</Td>
              <Td className="text-xs">{fmtDateTimeZoned(a.startedAt, tz)}</Td>
              <Td className="text-xs">{a.submittedAt ? fmtDateTimeZoned(a.submittedAt, tz) : "in progress"}</Td>
              <Td className="text-right tabular">{a.score ?? "—"} / {a.maxScore}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
