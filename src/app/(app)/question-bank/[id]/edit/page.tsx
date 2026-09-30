import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";
import { loadCourseOptions } from "@/features/question-bank/course-options";
import { QuestionForm } from "@/features/question-bank/question-form";
import type { QuestionOptionData } from "@/lib/domain/paper-types";
import { requirePageAuth } from "@/server/auth/current";
import { isAppError } from "@/server/errors";
import { getQuestion } from "@/server/services/questions";

export const metadata: Metadata = { title: "Edit question" };

export default async function EditQuestionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth(["question.edit.own", "question.edit.any"]);
  let q;
  try {
    q = await getQuestion(ctx, id);
  } catch (e) {
    if (isAppError(e)) notFound();
    throw e;
  }
  const v = q.versions[0];
  const opts = (v.options as QuestionOptionData | null) ?? null;
  const courses = await loadCourseOptions({ id: q.courseId });
  return (
    <div>
      <PageHeader breadcrumbs={[{ label: "Question bank", href: "/question-bank" }, { label: q.code, href: `/question-bank/${id}` }, { label: "Edit" }]} title={`Edit ${q.code}`} description={`Saving creates version ${q.currentVersion + 1}. Papers keep the exact version they used, so history stays reproducible.`} />
      <QuestionForm
        questionId={id}
        courses={courses}
        initial={{
          courseId: q.courseId,
          unitId: q.unitId,
          topicId: q.topicId ?? "",
          outcomeId: q.outcomeId ?? "",
          type: q.type,
          bloom: q.bloom,
          difficulty: q.difficulty,
          marks: q.marks,
          estimatedMinutes: q.estimatedMinutes,
          body: v.body,
          choices: opts?.choices?.map((c) => ({ text: c.text, correct: !!c.correct })) ?? [],
          pairs: opts?.pairs ?? [],
          answerKey: v.answerKey ?? "",
          keywords: q.keywords.join(", "),
          tags: q.tags.map((t) => t.tag.name).join(", "),
        }}
      />
    </div>
  );
}
