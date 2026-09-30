import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/app/page";
import { TemplateDialog, WatermarkDialog } from "@/features/templates/editors";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Templates & branding" };

const KIND_LABEL: Record<string, string> = { PREVIEW: "Preview", DRAFT_PDF: "Draft PDF", MODERATION_PDF: "Moderation PDF", FINAL_PDF: "Final PDF" };

export default async function TemplatesPage() {
  const ctx = await requirePageAuth("admin.templates.manage");
  const [templates, watermarks] = await Promise.all([
    db.template.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }], include: { _count: { select: { examinations: true } } } }),
    db.watermark.findMany({ orderBy: { createdAt: "asc" } }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Templates & branding"
        description="Question-paper layouts (header, instructions, typography, margins) and the confidentiality watermarks applied to previews and PDFs."
        actions={can(ctx, "admin.institution.manage") ? <Link href="/admin/institution" className="text-sm font-medium text-primary hover:underline">University logo & name →</Link> : null}
      />
      <Section title="Question-paper templates" actions={<TemplateDialog />} bodyClassName="p-0">
        <ul className="divide-y">
          {templates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">{t.name}{t.isDefault && <span className="rounded-full bg-primary/10 px-2 text-[11px] font-semibold text-primary">Default</span>}</div>
                <div className="text-xs text-muted-foreground">{t.headerTitle ?? "Institution name"} · {t.fontFamily} {t.fontSizePt} pt · {t.marginMm} mm margins · {t.showRegNoBoxes ? "register boxes" : "no register boxes"} · used by {t._count.examinations} examination(s)</div>
              </div>
              <TemplateDialog
                id={t.id}
                initial={{
                  name: t.name, headerTitle: t.headerTitle ?? "", headerSubtitle: t.headerSubtitle ?? "", instructions: t.instructions ?? "", footerText: t.footerText ?? "",
                  fontFamily: t.fontFamily as "Times New Roman", fontSizePt: t.fontSizePt, marginMm: t.marginMm, showLogo: t.showLogo, showRegNoBoxes: t.showRegNoBoxes, isDefault: t.isDefault,
                }}
              />
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Watermarks" description="At least one active watermark must always apply to final PDFs." actions={<WatermarkDialog />} bodyClassName="p-0">
        <ul className="divide-y">
          {watermarks.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">{w.name}{!w.isActive && <span className="rounded-full bg-muted px-2 text-[11px]">Inactive</span>}</div>
                <code className="text-xs text-muted-foreground">{w.text}</code>
                <div className="mt-1 flex flex-wrap gap-1">{w.appliesTo.map((k) => <span key={k} className="rounded bg-muted px-1.5 text-[11px]">{KIND_LABEL[k] ?? k}</span>)}</div>
              </div>
              <WatermarkDialog id={w.id} initial={{ name: w.name, text: w.text, opacity: w.opacity, angle: w.angle, appliesTo: w.appliesTo, isActive: w.isActive }} />
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
