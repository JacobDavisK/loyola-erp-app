import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { ConfidentialViewer } from "@/components/paper/confidential-viewer";
import { PaperDocument, WatermarkOverlay } from "@/components/paper/paper-document";
import { ScrutinyPanel } from "@/features/review/scrutiny-panel";
import { PAPER_STATUS } from "@/lib/domain/labels";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { isAppError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { resolveWatermarks, templateForPaper } from "@/server/services/paper-view";
import { computeScrutiny, currentVersionLabel, paperForUser } from "@/server/services/papers";
import { signedAssetUrl } from "@/server/storage";

export const metadata: Metadata = { title: "Scrutiny" };

export default async function ScrutinyWorkspace({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth("scrutiny.perform");
  let access;
  try {
    access = await paperForUser(ctx, id);
  } catch (e) {
    if (isAppError(e)) notFound();
    throw e;
  }
  if (!access.caps.scrutinize) notFound();
  const full = await db.questionPaper.findUniqueOrThrow({ where: { id }, include: { examination: { include: { course: true, session: true } } } });
  const [{ checks, ready, snapshot }, template, watermarks, inst] = await Promise.all([
    computeScrutiny(id),
    templateForPaper(id),
    resolveWatermarks("PREVIEW", { user: `${ctx.user.name} (${ctx.user.employeeId})`, session: full.examination.session.code, paper: full.code }),
    db.institution.findFirst(),
  ]);
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "paper.access", resourceType: "paper", resourceId: id, summary: `${full.code} opened in scrutiny workspace` });

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Scrutiny", href: "/scrutiny" }, { label: full.code }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {full.examination.course.code} — {full.examination.course.title}
            <StatusBadge meta={PAPER_STATUS[full.status]} size="md" />
          </span>
        }
        description={`Final technical scrutiny · version ${currentVersionLabel(full)} · checks are recomputed from the live paper on every load`}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <ConfidentialViewer>
          <div className="confidential overflow-hidden rounded-sm bg-white shadow-[var(--shadow-float)]">
            <div className="relative" style={{ padding: `${template.marginMm}mm` }}>
              {watermarks.length > 0 && <WatermarkOverlay texts={watermarks.map((w) => w.text)} opacity={Math.max(...watermarks.map((w) => w.opacity))} angle={watermarks[0].angle} />}
              <PaperDocument snapshot={snapshot} template={template} logoUrl={inst?.logoAssetId ? signedAssetUrl(inst.logoAssetId) : null} assetUrl={(a) => signedAssetUrl(a)} />
            </div>
          </div>
        </ConfidentialViewer>
        <div className="xl:sticky xl:top-20 xl:h-fit">
          <ScrutinyPanel paperId={id} checks={checks} ready={ready} canAct={full.status === "UNDER_SCRUTINY"} />
        </div>
      </div>
    </div>
  );
}
