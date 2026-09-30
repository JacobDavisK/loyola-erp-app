import "server-only";
import type { PaperTemplateData } from "@/components/paper/paper-document";
import { validateAgainstBlueprint } from "@/lib/domain/blueprint";
import type { PaperSnapshot } from "@/lib/domain/paper-types";
import { paperForUser, availableActions, blueprintSpec, currentVersionLabel, snapshotOf } from "@/server/services/papers";
import type { AuthContext } from "@/server/auth/current";
import { db } from "@/server/db";

export type WatermarkKind = "PREVIEW" | "DRAFT_PDF" | "MODERATION_PDF" | "FINAL_PDF";

/** Resolve active watermarks for a context, substituting viewer placeholders. */
export async function resolveWatermarks(kind: WatermarkKind, vars: { user: string; session: string; paper: string }) {
  const rows = await db.watermark.findMany({ where: { isActive: true, appliesTo: { has: kind } }, orderBy: { createdAt: "asc" } });
  const ts = new Date().toLocaleString("en-GB", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  return rows.map((w) => ({
    text: w.text.replaceAll("{USER}", vars.user).replaceAll("{SESSION}", vars.session).replaceAll("{TIMESTAMP}", ts).replaceAll("{PAPER}", vars.paper),
    opacity: w.opacity,
    angle: w.angle,
  }));
}

export async function templateForPaper(paperId: string): Promise<PaperTemplateData> {
  const p = await db.questionPaper.findUniqueOrThrow({ where: { id: paperId }, select: { examination: { select: { template: true } } } });
  const t = p.examination.template ?? (await db.template.findFirst({ where: { isDefault: true, kind: "PAPER" } }));
  return {
    headerTitle: t?.headerTitle ?? null,
    headerSubtitle: t?.headerSubtitle ?? null,
    instructions: t?.instructions ?? null,
    footerText: t?.footerText ?? "Confidential",
    showRegNoBoxes: t?.showRegNoBoxes ?? true,
    showLogo: t?.showLogo ?? true,
    fontFamily: t?.fontFamily ?? "Times New Roman",
    fontSizePt: t?.fontSizePt ?? 12,
    marginMm: t?.marginMm ?? 18,
  };
}

export async function paperDetail(ctx: AuthContext, paperId: string) {
  const { paper, caps } = await paperForUser(ctx, paperId);
  const [full, snapshot, bp, actions] = await Promise.all([
    db.questionPaper.findUniqueOrThrow({
      where: { id: paperId },
      include: {
        setter: { select: { id: true, name: true, designation: true } },
        assignment: { include: { backupSetter: { select: { name: true } }, assignedBy: { select: { name: true } } } },
        examination: {
          include: {
            course: { include: { department: true, program: true, semester: true } },
            session: true,
            schedule: true,
            moderator: { select: { name: true } },
            scrutinizer: { select: { name: true } },
          },
        },
        versions: { orderBy: [{ major: "desc" }, { minor: "desc" }], select: { id: true, label: true, isFinal: true, status: true, reason: true, contentHash: true, createdAt: true, createdBy: { select: { name: true } } } },
        transitions: { orderBy: { createdAt: "desc" }, include: { actor: { select: { name: true } } } },
        moderations: { orderBy: { round: "desc" }, include: { moderator: { select: { name: true } } } },
        scrutinies: { orderBy: { round: "desc" }, include: { officer: { select: { name: true } } } },
        approvals: { orderBy: { createdAt: "desc" }, include: { approver: { select: { name: true } } } },
        comments: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } }, item: { select: { question: { select: { code: true } } } } } },
      },
    }),
    snapshotOf(paperId),
    blueprintSpec(paper.blueprintId),
    availableActions(ctx, paperId),
  ]);
  const report = bp ? validateAgainstBlueprint(snapshot.sections, bp) : null;
  return { paper: full, caps, snapshot, blueprint: bp, report, actions, versionLabel: currentVersionLabel(full) };
}

export function numberItems(snapshot: PaperSnapshot) {
  const map = new Map<string, number>();
  let n = 0;
  for (const s of snapshot.sections) for (const i of s.items) map.set(i.itemId, ++n);
  return map;
}
