import Link from "next/link";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, SearchForm, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/features/academic-ops/controls";
import { deleteArticleAction, saveArticleAction } from "@/features/success/actions";
import { ARTICLE_FIELDS } from "@/features/success/fields";
import { fmtDate } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { audiencesFor, searchArticles } from "@/server/services/knowledge";

export const metadata: Metadata = { title: "Knowledge base" };

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requirePageAuth();
  const { q } = await searchParams;
  const manage = can(ctx, "knowledge.manage");
  const articles = q ? await searchArticles(ctx, q, 30) : await db.knowledgeArticle.findMany({ where: manage ? {} : { published: true, audience: { in: audiencesFor(ctx) } }, orderBy: [{ category: "asc" }, { title: "asc" }] });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Knowledge base"
        description="How things work: fees, examinations, certificates, hostel, library and more. The student assistant answers from these articles."
        actions={manage ? <FormDialog title="Article" columns={2} fields={ARTICLE_FIELDS} action={saveArticleAction} initial={{ audience: "STUDENT", published: true }} trigger={<Button size="sm"><Plus /> New article</Button>} /> : undefined}
      />
      <SearchForm defaultValue={q} placeholder="Search, e.g. revaluation, bonafide, hostel" />
      <Section title={q ? `Results for “${q}”` : "All articles"} bodyClassName="p-0">
        <DataTable head={[{ label: "Article" }, { label: "Category" }, { label: "Updated" }, ...(manage ? [{ label: "" }] : [])]} empty="No articles found.">
          {articles.map((a) => (
            <tr key={a.id}>
              <Td><Link className="font-medium hover:text-primary" href={`/knowledge/${a.slug}`}>{a.title}</Link>{!a.published && <span className="ml-2 text-xs text-tone-warning">draft</span>}<div className="text-xs text-muted-foreground">{a.tags.join(", ")}</div></Td>
              <Td className="text-xs">{a.category}</Td>
              <Td className="text-xs">{fmtDate(a.updatedAt)}</Td>
              {manage && (
                <Td className="whitespace-nowrap text-right">
                  <FormDialog title="Article" columns={2} id={a.id} fields={ARTICLE_FIELDS} action={saveArticleAction} initial={{ title: a.title, category: a.category, audience: a.audience, tags: a.tags.join(", "), body: a.body, published: a.published }} />
                  <ActionButton size="xs" variant="ghost" label="Delete" confirmText={`Delete "${a.title}"?`} run={deleteArticleAction.bind(null, a.id)} />
                </Td>
              )}
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
