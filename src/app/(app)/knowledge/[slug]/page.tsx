import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/app/page";
import { RichContent } from "@/components/app/rich-content";
import { fmtDate } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { audiencesFor } from "@/server/services/knowledge";

export const metadata: Metadata = { title: "Knowledge base" };

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requirePageAuth();
  const a = await db.knowledgeArticle.findUnique({ where: { slug } });
  if (!a || (!can(ctx, "knowledge.manage") && (!a.published || !audiencesFor(ctx).includes(a.audience)))) notFound();
  return (
    <div className="space-y-6">
      <PageHeader breadcrumbs={[{ label: "Knowledge base", href: "/knowledge" }, { label: a.category }]} title={a.title} description={`Updated ${fmtDate(a.updatedAt)}${a.tags.length ? ` · ${a.tags.join(", ")}` : ""}`} />
      <Section><div className="max-w-3xl text-sm leading-relaxed"><RichContent body={a.body} /></div></Section>
    </div>
  );
}
