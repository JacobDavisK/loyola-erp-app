import Link from "next/link";
import { Award, FilePlus2 } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { FormDialog } from "@/components/app/form-dialog";
import { EmptyState, PageHeader, Section, StatCard } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { requestCredentialAction } from "@/features/results/actions";
import { RevaluationButtons } from "@/features/results/portal-controls";
import { COURSE_RESULT_STATUS, CREDENTIAL_STATUS, REVAL_STATUS } from "@/lib/domain/labels";
import { fmtDate } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { CREDENTIAL_LABEL } from "@/server/services/credential-issue";
import { REQUESTABLE } from "@/server/services/credentials";
import { portalSubject } from "@/server/services/portal";
import { studentResults } from "@/server/services/results";
import { getSetting } from "@/server/services/settings";

export const metadata: Metadata = { title: "Results" };

export default async function PortalResultsPage({ searchParams }: { searchParams: Promise<{ student?: string }> }) {
  const ctx = await requirePageAuth("self.portal");
  const sp = await searchParams;
  const subject = await portalSubject(ctx, sp.student);
  if (!subject.canAcademic) return <div><PageHeader title="Results" /><EmptyState icon={Award} title="Not shared with this account" /></div>;
  const s = subject.student;
  const [{ courses, terms, cgpa }, settings, credentials, pendingRequests] = await Promise.all([
    studentResults(ctx, s.id),
    getSetting("examination"),
    db.issuedCredential.findMany({ where: { studentId: s.id }, orderBy: { issuedAt: "desc" } }),
    db.workflowInstance.findMany({ where: { key: "credential.request", initiatorId: ctx.user.id, status: { in: ["IN_PROGRESS", "RETURNED"] } }, orderBy: { createdAt: "desc" } }),
  ]);
  const byTerm = new Map<string, { name: string; rows: typeof courses }>();
  for (const c of courses) {
    const t = c.run.term;
    (byTerm.get(t.id) ?? byTerm.set(t.id, { name: t.name, rows: [] }).get(t.id)!).rows.push(c);
  }
  const now = new Date();
  const windowOpen = (c: (typeof courses)[number]) => {
    if (!c.run.publishedAt) return false;
    const until = c.run.session.revaluationUntil ?? new Date(c.run.publishedAt.getTime() + settings.revaluationWindowDays * 86_400_000);
    return now <= until;
  };
  const canRequest = subject.isSelf && can(ctx, "credential.request");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Results"
        description={`${s.firstName} ${s.lastName} · ${s.program.name}`}
        actions={canRequest && (
          <FormDialog
            title="Certificate request"
            description="The Registrar's office reviews the request; the document is issued with a verification code you can share."
            fields={[
              { name: "type", label: "Document", type: "select", options: REQUESTABLE.map((t) => ({ value: t, label: CREDENTIAL_LABEL[t] })) },
              { name: "termId", label: "Term (statement of marks only)", type: "select", optional: true, options: [...byTerm.entries()].map(([id, t]) => ({ value: id, label: t.name })) },
              { name: "purpose", label: "Purpose", type: "textarea", placeholder: "e.g. passport application, bank loan, higher studies" },
            ]}
            action={requestCredentialAction}
            submitLabel="Send request"
            trigger={<Button size="sm"><FilePlus2 /> Request a certificate</Button>}
          />
        )}
      />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
        <StatCard label="CGPA" value={cgpa ?? "—"} icon={Award} />
        <StatCard label="Credits earned" value={terms[0]?.cumulativeCredits ?? 0} />
        <StatCard label="Latest SGPA" value={terms[0]?.sgpa ?? "—"} />
      </div>
      {byTerm.size === 0 && <EmptyState icon={Award} title="No published results yet" />}
      {[...byTerm.entries()].map(([termId, t]) => {
        const tr = terms.find((x) => x.termId === termId);
        return (
          <Section key={termId} title={t.name} description={tr ? `SGPA ${tr.sgpa ?? "—"} · ${tr.creditsEarned} of ${tr.creditsRegistered} credits earned · CGPA ${tr.cgpa ?? "—"}` : undefined} bodyClassName="p-0">
            <DataTable head={[{ label: "Course" }, { label: "Credits", className: "text-right" }, { label: "Marks", className: "text-right" }, { label: "Grade" }, { label: "Result" }, { label: "" }]}>
              {t.rows.map((c) => {
                const reval = c.revaluations[0];
                const openReval = reval && ["REQUESTED", "FEE_PENDING", "IN_PROGRESS"].includes(reval.status);
                return (
                  <tr key={c.id}>
                    <Td><span className="font-mono text-xs text-muted-foreground">{c.course.code}</span> {c.course.title}{c.version > 1 && <div className="text-[11px] text-muted-foreground">Revised — {c.revisionReason}</div>}</Td>
                    <Td className="text-right tabular">{c.credits}</Td>
                    <Td className="text-right tabular">{c.totalMarks ?? "—"} / {c.maxMarks}</Td>
                    <Td className="font-semibold">{c.grade}</Td>
                    <Td><StatusBadge meta={COURSE_RESULT_STATUS[c.status]} /></Td>
                    <Td className="text-right">
                      {reval ? <StatusBadge meta={REVAL_STATUS[reval.status]} /> : null}
                      {subject.isSelf && !openReval && windowOpen(c) && ["PASS", "FAIL"].includes(c.status) && can(ctx, "revaluation.request") && <RevaluationButtons courseResultId={c.id} fees={{ revaluation: settings.revaluationFee, retotalling: settings.retotallingFee }} />}
                    </Td>
                  </tr>
                );
              })}
            </DataTable>
          </Section>
        );
      })}
      {(credentials.length > 0 || pendingRequests.length > 0) && (
        <Section title="Certificates & transcripts" bodyClassName="p-0">
          <ul className="divide-y text-sm">
            {pendingRequests.map((p) => <li key={p.id} className="flex items-center gap-3 px-5 py-2.5"><span className="flex-1">{p.title}</span><Link href={`/inbox/requests/${p.id}`} className="text-xs text-primary hover:underline">In review →</Link></li>)}
            {credentials.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                <span className="flex-1"><Link href={`/credentials/${c.id}`} className="font-medium hover:text-primary">{c.title}</Link><span className="block font-mono text-[11px] text-muted-foreground">{c.serialNo} · issued {fmtDate(c.issuedAt)}</span></span>
                <StatusBadge meta={CREDENTIAL_STATUS[c.status]} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
