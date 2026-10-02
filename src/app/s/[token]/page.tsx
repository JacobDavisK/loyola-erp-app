import type { Metadata } from "next";
import { SurveyForm } from "@/features/teaching/controls";
import { BRAND } from "@/lib/brand";
import type { SurveyQuestion } from "@/lib/domain/teaching";
import { db } from "@/server/db";
import { publicSurvey } from "@/server/services/surveys";

export const metadata: Metadata = { title: "Survey" };
export const dynamic = "force-dynamic";

/** Public survey link (alumni, employers) — no account needed. */
export default async function PublicSurveyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [survey, inst] = await Promise.all([publicSurvey(token).catch(() => null), db.institution.findFirst({ select: { name: true } })]);
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="text-xs font-semibold tracking-[0.15em] text-muted-foreground">{inst?.name ?? BRAND.name}</div>
      {survey ? (
        <>
          <h1 className="mt-2 text-2xl font-semibold">{survey.title}</h1>
          <p className="mb-6 mt-1 text-sm text-muted-foreground">Your answers help us improve our programmes.{survey.anonymous ? " The survey is anonymous." : ""} Every question is optional.</p>
          <SurveyForm surveyId={survey.id} publicToken={token} questions={survey.questions as unknown as SurveyQuestion[]} />
        </>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">This survey is closed or the link is not valid.</p>
      )}
    </main>
  );
}
