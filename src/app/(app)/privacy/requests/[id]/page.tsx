import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { DataRequestControls } from "@/features/compliance/controls";
import { DATA_REQUEST_STATUS, DATA_REQUEST_TYPE } from "@/features/compliance/labels";
import { fmtDateTime } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { loadDataRequest } from "@/server/services/privacy";
import { signedAssetUrl } from "@/server/storage";

export const metadata: Metadata = { title: "Data-principal request" };

export default async function DataRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth();
  const r = await loadDataRequest(ctx, id).catch(() => null);
  if (!r) notFound();
  const dpo = can(ctx, "privacy.manage") && r.userId !== ctx.user.id;
  const student = dpo ? await db.student.findUnique({ where: { userId: r.userId }, select: { id: true, studentNo: true } }) : null;
  return (
    <div className="space-y-6">
      <PageHeader breadcrumbs={dpo ? [{ label: "Data protection", href: "/privacy" }, { label: r.number }] : [{ label: "Privacy", href: "/me/privacy" }, { label: r.number }]} eyebrow={<span className="font-mono">{r.number}</span>} title={DATA_REQUEST_TYPE[r.type]} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Request">
          <KeyValue items={[
            ["From", <span key="f">{r.user.name} ({r.user.email}){student ? <> · <Link className="text-primary hover:underline" href={`/students/${student.id}`}>{student.studentNo}</Link></> : null}</span>],
            ["Raised", fmtDateTime(r.createdAt)],
            ["Respond by", fmtDateTime(r.dueAt)],
            ["Status", <StatusBadge key="s" meta={DATA_REQUEST_STATUS[r.status]} />],
          ]} />
          <p className="mt-4 whitespace-pre-wrap text-sm">{r.details}</p>
        </Section>
        <Section title="Response">
          <div className="space-y-4">
            {r.response && <p className="whitespace-pre-wrap text-sm">{r.response}</p>}
            {r.exportAssetId && <a className="text-sm font-medium text-primary hover:underline" href={signedAssetUrl(r.exportAssetId, 600, "attachment")}>Download the personal-data export (JSON)</a>}
            {dpo && <DataRequestControls id={r.id} status={r.status} type={r.type} hasExport={!!r.exportAssetId} />}
            {!r.response && !dpo && <p className="text-sm text-muted-foreground">The Data Protection Officer will respond by {fmtDateTime(r.dueAt)}.</p>}
          </div>
        </Section>
      </div>
    </div>
  );
}
