import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";
import { loadCourseOptions } from "@/features/question-bank/course-options";
import { QuestionForm } from "@/features/question-bank/question-form";
import { authorableCourseWhere } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/current";

export const metadata: Metadata = { title: "New question" };

export default async function NewQuestionPage({ searchParams }: { searchParams: Promise<{ courseId?: string }> }) {
  const ctx = await requirePageAuth("question.create");
  const { courseId } = await searchParams;
  const courses = await loadCourseOptions(authorableCourseWhere(ctx));
  const preset = courses.find((c) => c.id === courseId)?.id;
  return (
    <div>
      <PageHeader breadcrumbs={[{ label: "Question bank", href: "/question-bank" }, { label: "New question" }]} title="New question" description="Questions from authors without review rights enter the review queue before they can be used in papers." />
      <QuestionForm courses={courses} initial={preset ? { courseId: preset } : undefined} />
    </div>
  );
}
