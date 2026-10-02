import { ClipboardCheck } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState, PageHeader, Section } from "@/components/app/page";
import { SurveyForm } from "@/features/teaching/controls";
import { requirePageAuth } from "@/server/auth/current";
import { loadSurveyForm } from "@/server/services/surveys";

export const metadata: Metadata = { title: "Survey" };

export default async function RespondPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth();
  const f = await loadSurveyForm(ctx, id).catch(() => null);
  if (!f) return <EmptyState icon={ClipboardCheck} title="Survey not available" description="It may have closed, or it is not meant for you." />;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader breadcrumbs={[{ label: "Surveys", href: "/surveys" }, { label: f.survey.title }]} title={f.survey.title} description={f.survey.anonymous ? "Anonymous: your name is not stored with your answers. Every question is optional." : "Every question is optional."} />
      <Section>{f.answered ? <p className="text-sm text-tone-success">You have answered this survey. Thank you!</p> : <SurveyForm surveyId={f.survey.id} questions={f.questions} />}</Section>
    </div>
  );
}
