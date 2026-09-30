import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionButton } from "@/features/academic-ops/controls";
import { removeEvidenceAction } from "@/features/quality/actions";
import { EvidenceForm, ReopenButton, ResponseEditor, ReviewForm } from "@/features/quality/controls";
import { RESPONSE_STATUS } from "@/features/quality/fields";
import { fmtDateTime } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { loadResponseFor, periodOf } from "@/server/services/iqac";
import { SOURCES } from "@/server/services/iqac-sources";
import { signedAssetUrl } from "@/server/storage";

export const metadata: Metadata = { title: "Metric" };

type Snapshot = { value: number; unit: string; inputs: Record<string, number | string>; note: string; period: string; computedAt: string; source: string };

export default async function ResponsePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth();
  const r = await loadResponseFor(ctx, id).catch(() => null);
  if (!r) notFound();
  const { response: x, owner, manage, editable } = r;
  const snap = x.computed as Snapshot | null;
  const period = periodOf(x.cycle);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        eyebrow={`${x.cycle.framework.code} ${x.metric.code} · ${x.cycle.name}`}
        title={x.metric.title}
        breadcrumbs={[{ label: owner && !manage ? "Accreditation tasks" : x.cycle.name, href: owner && !manage ? "/iqac/my" : `/iqac/cycles/${x.cycleId}` }, { label: x.metric.code }]}
        description={<span className="flex flex-wrap items-center gap-2"><StatusBadge meta={RESPONSE_STATUS[x.status]} /> {x.metric.kind === "QUANTITATIVE" ? "Quantitative" : "Narrative"} · weight {x.metric.weight || "—"} · owner {x.assignee?.name ?? "unassigned"} · data period {period.label}</span>}
      />
      {x.metric.guidance && <Section title="Guidance"><p className="whitespace-pre-wrap text-sm">{x.metric.guidance}</p></Section>}
      {x.reviewNote && <div className="rounded-xl border border-tone-warning/40 bg-tone-warning/5 px-4 py-3 text-sm"><b>IQAC note:</b> {x.reviewNote}</div>}
      <Section title="Response" description={x.metric.source ? `Platform data: ${SOURCES[x.metric.source]?.label ?? x.metric.source}` : undefined}>
        {editable ? (
          <ResponseEditor id={x.id} kind={x.metric.kind} value={x.value} narrative={x.narrative} hasSource={!!x.metric.source} unit={x.metric.unit} />
        ) : (
          <div className="space-y-2 text-sm">
            {x.metric.kind === "QUANTITATIVE" && <p className="text-2xl font-semibold tabular">{x.value ?? "—"} <span className="text-sm font-normal text-muted-foreground">{x.metric.unit}</span></p>}
            {x.narrative ? <p className="whitespace-pre-wrap">{x.narrative}</p> : <p className="text-muted-foreground">No narrative.</p>}
          </div>
        )}
        {snap && (
          <div className="mt-4 rounded-lg bg-muted/40 p-3 text-xs">
            <p><b>Computed from platform records</b> ({snap.period}, {fmtDateTime(snap.computedAt)}): {snap.note}</p>
            <KeyValue className="mt-2" items={Object.entries(snap.inputs).map(([k, v]) => [k, String(v)] as [string, string])} />
          </div>
        )}
      </Section>
      <Section title="Evidence" description={`${x.evidence.length} item(s)`}>
        <ul className="mb-3 space-y-1.5 text-sm">
          {x.evidence.map((e) => (
            <li key={e.id} className="flex items-center gap-2">
              {e.file ? <a className="text-primary hover:underline" href={signedAssetUrl(e.file.id, 900, "attachment")}>{e.label}</a> : <a className="text-primary hover:underline" href={e.url!} target="_blank" rel="noopener noreferrer nofollow">{e.label}</a>}
              <span className="text-xs text-muted-foreground">{e.file ? `${e.file.originalName} · ${Math.ceil(e.file.size / 1024)} KB` : "link"}</span>
              {editable && <ActionButton size="xs" variant="ghost" label="" ariaLabel="Remove evidence" icon={<Trash2 />} run={removeEvidenceAction.bind(null, e.id)} confirmText="Remove this evidence?" />}
            </li>
          ))}
          {x.evidence.length === 0 && <li className="text-muted-foreground">None attached.</li>}
        </ul>
        {editable && <EvidenceForm id={x.id} />}
      </Section>
      {manage && x.status === "SUBMITTED" && x.assigneeId !== ctx.user.id && <Section title="IQAC review"><ReviewForm id={x.id} /></Section>}
      {manage && x.status === "APPROVED" && !x.cycle.isClosed && <ReopenButton id={x.id} />}
    </div>
  );
}
