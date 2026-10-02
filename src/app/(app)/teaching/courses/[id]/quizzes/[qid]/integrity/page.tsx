import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { fmtDateTime } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { integrityReport, PROCTOR_LABEL } from "@/server/services/proctoring";

export const metadata: Metadata = { title: "Integrity report" };

export default async function IntegrityPage({ params }: { params: Promise<{ id: string; qid: string }> }) {
  const { id, qid } = await params;
  const ctx = await requirePageAuth();
  const r = await integrityReport(ctx, qid).catch(() => null);
  if (!r || r.quiz.offeringId !== id) notFound();
  const flagged = r.attempts.filter((a) => a.flagged).length;
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Course space", href: `/teaching/courses/${id}?tab=quizzes` }, { label: r.quiz.title, href: `/teaching/courses/${id}/quizzes/${qid}` }, { label: "Integrity" }]}
        title={`Integrity report — ${r.quiz.title}`}
        description={`${r.attempts.length} attempt(s); ${flagged} with ${r.threshold} or more recorded incidents. Incidents are prompts to review, not proof: a student may have had a notification or a connection problem. Talk to the student before acting.`}
      />
      <Section bodyClassName="p-0">
        <DataTable head={[{ label: "Student" }, { label: "Score" }, { label: "Incidents" }, { label: "Timeline" }, { label: "Webcam" }]} empty="No attempts yet.">
          {r.attempts.map((a) => (
            <tr key={a.id} className={a.flagged ? "bg-tone-warning/5 align-top" : "align-top"}>
              <Td><div className="font-medium">{a.student.firstName} {a.student.lastName}</div><div className="font-mono text-xs text-muted-foreground">{a.student.studentNo} · attempt {a.attemptNo}</div>{a.consentAt && <div className="text-[11px] text-muted-foreground">notice accepted {fmtDateTime(a.consentAt)}</div>}</Td>
              <Td>{a.score ?? "—"} / {a.maxScore}</Td>
              <Td>
                <div className={a.flagged ? "font-semibold text-tone-warning" : undefined}>{a.incidents}{a.flagged ? " · review" : ""}</div>
                <ul className="text-xs text-muted-foreground">{Object.entries(a.counts).map(([k, n]) => <li key={k}>{PROCTOR_LABEL[k as keyof typeof PROCTOR_LABEL] ?? k}: {n}</li>)}</ul>
              </Td>
              <Td>
                <details><summary className="cursor-pointer text-xs text-primary">{a.timeline.length} event(s)</summary>
                  <ol className="mt-1 max-h-48 overflow-y-auto text-xs">{a.timeline.map((e, i) => <li key={i}>{fmtDateTime(e.at)} — {PROCTOR_LABEL[e.kind as keyof typeof PROCTOR_LABEL] ?? e.kind}</li>)}</ol>
                </details>
              </Td>
              <Td>
                {a.frames.length ? (
                  <div className="flex max-w-72 flex-wrap gap-1">
                    {a.frames.slice(0, 12).map((f, i) => (
                      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URLs of private files
                      <a key={i} href={f.url} target="_blank" rel="noreferrer" title={fmtDateTime(f.at)}><img src={f.url} alt={`Webcam frame ${i + 1}`} className="h-12 w-16 rounded object-cover" /></a>
                    ))}
                  </div>
                ) : <span className="text-xs text-muted-foreground">—</span>}
              </Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
