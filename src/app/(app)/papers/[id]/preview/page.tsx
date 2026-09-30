import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import { StatusBadge } from "@/components/app/status-badge";
import { ConfidentialViewer } from "@/components/paper/confidential-viewer";
import { PaperDocument, WatermarkOverlay } from "@/components/paper/paper-document";
import { Button } from "@/components/ui/button";
import { PAPER_STATUS } from "@/lib/domain/labels";
import { FINAL_EXPORTABLE } from "@/lib/domain/workflow";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { isAppError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { resolveWatermarks, templateForPaper } from "@/server/services/paper-view";
import { currentVersionLabel, paperForUser, snapshotOf } from "@/server/services/papers";
import { signedAssetUrl } from "@/server/storage";

export const metadata: Metadata = { title: "Print preview" };

export default async function PreviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ version?: string }> }) {
  const { id } = await params;
  const { version } = await searchParams;
  const ctx = await requirePageAuth();
  let access;
  try {
    access = await paperForUser(ctx, id);
  } catch (e) {
    if (isAppError(e)) notFound();
    throw e;
  }
  const { paper, caps } = access;
  const full = await db.questionPaper.findUniqueOrThrow({ where: { id }, include: { examination: { include: { session: true } } } });

  // A specific immutable version can be previewed (reproducibility of historical papers).
  let snapshot = await snapshotOf(id);
  let label = currentVersionLabel(full);
  if (!version && FINAL_EXPORTABLE.includes(paper.status)) {
    const final = await db.questionPaperVersion.findFirst({ where: { paperId: id, isFinal: true }, orderBy: { major: "desc" } });
    if (final) {
      snapshot = final.snapshot as unknown as typeof snapshot;
      label = final.label;
    }
  } else if (version) {
    const v = await db.questionPaperVersion.findFirst({ where: { paperId: id, id: version } });
    if (!v) notFound();
    snapshot = v.snapshot as unknown as typeof snapshot;
    label = v.label;
  }
  const [template, watermarks, inst] = await Promise.all([
    templateForPaper(id),
    resolveWatermarks("PREVIEW", { user: `${ctx.user.name} (${ctx.user.employeeId})`, session: full.examination.session.code, paper: full.code }),
    db.institution.findFirst(),
  ]);
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "paper.preview", resourceType: "paper", resourceId: id, summary: `${full.code} v${label} previewed` });
  const logoUrl = inst?.logoAssetId ? signedAssetUrl(inst.logoAssetId) : null;
  const assetUrl = (assetId: string) => signedAssetUrl(assetId);

  return (
    <div className="-mx-4 -my-6 min-h-[calc(100vh-3.5rem)] bg-[oklch(0.93_0.004_262)] px-4 py-6 sm:-mx-6 lg:-mx-8 lg:-my-8 dark:bg-[oklch(0.13_0.006_262)]">
      <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm"><Link href={`/papers/${id}`}><ArrowLeft /> Back</Link></Button>
        <div className="text-sm">
          <span className="font-mono font-medium">{full.code}</span> <span className="text-muted-foreground">· version {label}</span>
        </div>
        <StatusBadge meta={PAPER_STATUS[paper.status]} />
        <div className="ml-auto flex gap-2">
          {caps.exportDraft && (
            <Button asChild size="sm" variant="outline">
              <a href={`/api/papers/${id}/export?kind=${FINAL_EXPORTABLE.includes(paper.status) && caps.exportFinal ? "final" : "draft"}`}><Download /> Download PDF</a>
            </Button>
          )}
        </div>
      </div>
      <div className="mx-auto mb-3 flex max-w-[210mm] items-center gap-2 rounded-lg border border-tone-warning/30 bg-tone-warning/5 px-3 py-2 text-xs text-tone-warning">
        <ShieldAlert className="size-4 shrink-0" /> Confidential examination material. This view is watermarked with your identity and logged.
      </div>
      <ConfidentialViewer>
        <div className="confidential mx-auto max-w-[210mm] overflow-hidden rounded-sm bg-white shadow-[var(--shadow-float)]">
          <div className="relative" style={{ padding: `${template.marginMm}mm`, minHeight: "297mm" }}>
            {watermarks.length > 0 && <WatermarkOverlay texts={watermarks.map((w) => w.text)} opacity={Math.max(...watermarks.map((w) => w.opacity))} angle={watermarks[0].angle} />}
            <div className="relative z-0">
              <PaperDocument snapshot={snapshot} template={template} logoUrl={logoUrl} assetUrl={assetUrl} />
            </div>
          </div>
          <div className="border-t px-[18mm] py-2 text-center text-[10px] text-neutral-500">
            {template.footerText} · {full.code} · v{label} · page numbers are applied in the PDF
          </div>
        </div>
      </ConfidentialViewer>
    </div>
  );
}
