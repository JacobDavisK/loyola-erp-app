import { notFound } from "next/navigation";
import { Lock, Play } from "lucide-react";
import type { Metadata } from "next";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { ActionButton } from "@/features/academic-ops/controls";
import { setSurveyStatusAction } from "@/features/teaching/actions";
import { LIKERT_LABELS } from "@/lib/domain/teaching";
import { fmtDateTime } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { publicSurveyUrl, surveyResults } from "@/server/services/surveys";

export const metadata: Metadata = { title: "Survey results" };

export default async function SurveyResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth();
  let r;
  try {
    r = await surveyResults(ctx, id);
  } catch (e) {
    if (e instanceof Error && /five students|at least/.test(e.message)) {
      return <div className="space-y-6"><PageHeader breadcrumbs={[{ label: "Surveys", href: "/surveys" }, { label: "Results" }]} title="Results not available yet" description={e.message} /></div>;
    }
    notFound();
  }
  const s = r.survey;
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Surveys", href: "/surveys" }, { label: s.title }]}
        title={s.title}
        description={`${r.responses} response(s)${r.invited ? ` of ${r.invited} invited (${Math.round((r.responses / Math.max(1, r.invited)) * 100)}%)` : ""} · ${s.anonymous ? "anonymous" : "named"} · ${s.status.toLowerCase()}`}
        actions={r.manage ? (
          <>
            {s.status === "DRAFT" && <ActionButton label="Open survey" variant="default" icon={<Play />} run={setSurveyStatusAction.bind(null, s.id, "OPEN")} confirmText="Open the survey and notify the people who should answer?" />}
            {s.status === "OPEN" && <ActionButton label="Close survey" icon={<Lock />} run={setSurveyStatusAction.bind(null, s.id, "CLOSED")} confirmText="Close the survey? No more answers will be accepted." />}
          </>
        ) : undefined}
      />
      <Section title="About">
        <KeyValue items={[["Opens", fmtDateTime(s.opensAt)], ["Closes", fmtDateTime(s.closesAt)], ["Class", s.offering ? `${s.offering.course.code}-${s.offering.section} ${s.offering.course.title}` : "—"], ...(s.audience === "PUBLIC_LINK" && r.manage ? ([["Public link (share with alumni or employers)", <code key="l" className="break-all text-xs">{publicSurveyUrl(s.id)}</code>]] as [string, React.ReactNode][]) : [])]} />
      </Section>
      {r.summary.map((q, i) => (
        <Section key={q.id} title={`${i + 1}. ${q.text}`} description={`${q.answered} answer(s)${q.mean !== null ? ` · mean ${q.mean} / 5` : ""}`}>
          {q.type === "TEXT" ? (
            q.comments.length ? <ul className="space-y-2 text-sm">{q.comments.map((c, k) => <li key={k} className="rounded-lg bg-muted/40 px-3 py-2">{c}</li>)}</ul> : <p className="text-sm text-muted-foreground">No comments.</p>
          ) : (
            <ul className="space-y-1.5">
              {Object.entries(q.distribution).map(([k, n]) => {
                const pct = q.answered ? Math.round((n / q.answered) * 100) : 0;
                const label = q.type === "LIKERT" ? LIKERT_LABELS[Number(k) - 1] : k;
                return (
                  <li key={k} className="flex items-center gap-3 text-sm">
                    <span className="w-36 shrink-0 text-xs">{label}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden><span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></span>
                    <span className="w-16 text-right font-mono text-xs">{n} · {pct}%</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      ))}
    </div>
  );
}
