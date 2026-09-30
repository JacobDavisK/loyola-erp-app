import "server-only";
import type { PaperSnapshot } from "@/lib/domain/paper-types";
import { FINAL_EXPORTABLE } from "@/lib/domain/workflow";
import { loadPaperFor } from "@/server/auth/access";
import type { AuthContext } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, invalid, rateLimited } from "@/server/errors";
import { renderPaperPdf } from "@/server/pdf/render";
import { sha256 } from "@/server/security/crypto";
import { assertRate } from "@/server/security/rate-limit";
import { audit } from "@/server/services/audit";
import { resolveWatermarks, templateForPaper } from "@/server/services/paper-view";
import { currentVersionLabel, snapshotOf } from "@/server/services/papers";
import { getSetting } from "@/server/services/settings";

export type ExportKind = "draft" | "moderation" | "final";

const REVIEW_STATES = ["SUBMITTED", "RESUBMITTED", "UNDER_MODERATION", "UNDER_SCRUTINY", "AWAITING_APPROVAL", "APPROVED"];

/**
 * Produce a PDF for an authorised user. Final PDFs are rendered from the immutable FINAL version
 * snapshot, so historical papers are always reproducible byte-for-content.
 */
export async function exportPaperPdf(ctx: AuthContext, paperId: string, kind: ExportKind, opts: { skipAudit?: boolean } = {}) {
  if (!opts.skipAudit) assertRate(`export:${ctx.user.id}`, 30, 60_000);
  const { paper, caps } = await loadPaperFor(ctx, paperId);
  const full = await db.questionPaper.findUniqueOrThrow({ where: { id: paperId }, include: { examination: { include: { session: true, course: true } } } });
  let snapshot: PaperSnapshot;
  let versionLabel = currentVersionLabel(full);

  if (kind === "final") {
    if (!caps.exportFinal) throw forbidden("Only authorised examination officers can download final papers.");
    if (!FINAL_EXPORTABLE.includes(paper.status)) throw invalid("A final PDF is available only after the paper is approved and locked.");
    const security = await getSetting("security");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const used = await db.auditLog.count({ where: { actorId: ctx.user.id, action: "paper.export.final", createdAt: { gte: today } } });
    if (used >= security.maxFinalDownloadsPerUserPerDay) throw rateLimited("Daily final-paper download limit reached. Contact the Controller of Examinations.");
    const final = await db.questionPaperVersion.findFirst({ where: { paperId, isFinal: true }, orderBy: { major: "desc" } });
    if (!final) throw invalid("No final version exists for this paper.");
    snapshot = final.snapshot as unknown as PaperSnapshot;
    versionLabel = final.label;
  } else {
    if (!caps.exportDraft) throw forbidden();
    if (kind === "moderation" && !REVIEW_STATES.includes(paper.status)) throw invalid("Moderation copies are available once the paper is submitted.");
    snapshot = await snapshotOf(paperId);
  }

  const wmKind = kind === "final" ? "FINAL_PDF" : kind === "moderation" ? "MODERATION_PDF" : "DRAFT_PDF";
  const [template, watermarks, inst] = await Promise.all([
    templateForPaper(paperId),
    resolveWatermarks(wmKind, { user: `${ctx.user.name} (${ctx.user.employeeId})`, session: full.examination.session.code, paper: full.code }),
    db.institution.findFirst(),
  ]);
  if (kind !== "final") watermarks.unshift({ text: kind === "draft" ? "DRAFT — NOT FOR USE" : "MODERATION COPY — NOT FOR USE", opacity: 0.1, angle: -30 });

  const pdf = await renderPaperPdf({
    snapshot,
    template,
    watermarks,
    logoAssetId: inst?.logoAssetId,
    footerLabel: `${template.footerText ?? "Confidential"} · ${full.code} · v${versionLabel}${kind !== "final" ? ` · ${kind.toUpperCase()}` : ""}`,
  });
  const hash = sha256(pdf);
  if (!opts.skipAudit) {
    await audit({
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      action: `paper.export.${kind}`,
      resourceType: "paper",
      resourceId: paperId,
      summary: `${full.code} v${versionLabel} ${kind} PDF downloaded`,
      metadata: { sha256: hash, bytes: pdf.length, version: versionLabel },
    });
  }
  const fileName = `${full.examination.course.code}${kind === "final" ? "" : `-${kind}`}-v${versionLabel.replace(/\s+/g, "_")}.pdf`;
  return { pdf, fileName, hash, courseCode: full.examination.course.code };
}
