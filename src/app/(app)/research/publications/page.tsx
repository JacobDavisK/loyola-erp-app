import type { Metadata } from "next";
import type { Prisma } from "@/generated/prisma/client";
import { DataTable, Pagination, qs, SearchForm, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { ActionButton } from "@/features/academic-ops/controls";
import { verifyPublicationAction } from "@/features/quality/actions";
import { INDEXING, PUBLICATION_TYPES } from "@/features/quality/fields";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { publicationWhere } from "@/server/services/research";

export const metadata: Metadata = { title: "Publications" };

export default async function PublicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageAuth("research.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = 40;
  const and: Prisma.PublicationWhereInput[] = [publicationWhere(ctx)];
  if (sp.type && sp.type in PUBLICATION_TYPES) and.push({ type: sp.type as keyof typeof PUBLICATION_TYPES });
  if (sp.indexing && sp.indexing in INDEXING) and.push({ indexing: sp.indexing as keyof typeof INDEXING });
  if (sp.year && Number(sp.year)) and.push({ year: Number(sp.year) });
  if (sp.verified === "no") and.push({ verifiedAt: null });
  if (sp.q) and.push({ OR: [{ title: { contains: sp.q, mode: "insensitive" } }, { venue: { contains: sp.q, mode: "insensitive" } }, { authorsText: { contains: sp.q, mode: "insensitive" } }, { doi: { contains: sp.q.toLowerCase() } }] });
  const where = { AND: and };
  const [rows, total] = await Promise.all([
    db.publication.findMany({ where, orderBy: [{ year: "desc" }, { createdAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize, include: { department: { select: { code: true } }, authors: { orderBy: { position: "asc" }, include: { employee: { select: { firstName: true, lastName: true, userId: true } } } } } }),
    db.publication.count({ where }),
  ]);
  const manage = can(ctx, "research.manage");
  const base = { type: sp.type, indexing: sp.indexing, year: sp.year, verified: sp.verified, q: sp.q };
  return (
    <div className="space-y-4">
      <PageHeader title="Publications" breadcrumbs={[{ label: "Research", href: "/research" }, { label: "Publications" }]} description={`${total} publication(s). Faculty add their own under My research; the research office verifies them. Only verified publications count in accreditation data.`} />
      <div className="flex flex-wrap items-center gap-2">
        <form className="flex flex-wrap gap-2">
          <select name="type" defaultValue={sp.type ?? ""} aria-label="Type" className="h-8 rounded-lg border bg-card px-2 text-[13px]"><option value="">All types</option>{Object.entries(PUBLICATION_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <select name="indexing" defaultValue={sp.indexing ?? ""} aria-label="Indexing" className="h-8 rounded-lg border bg-card px-2 text-[13px]"><option value="">Any indexing</option>{Object.entries(INDEXING).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input name="year" type="number" defaultValue={sp.year} placeholder="Year" aria-label="Year" className="h-8 w-24 rounded-lg border bg-card px-2 text-[13px]" />
          <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" name="verified" value="no" defaultChecked={sp.verified === "no"} className="accent-[var(--primary)]" /> Unverified only</label>
          <button className="h-8 rounded-lg border px-3 text-[13px] hover:bg-muted">Apply</button>
        </form>
        <div className="ml-auto"><SearchForm defaultValue={sp.q} placeholder="Title, venue, author or DOI" hidden={{ type: sp.type, indexing: sp.indexing, year: sp.year, verified: sp.verified }} /></div>
      </div>
      <Section title="Publications" bodyClassName="p-0">
        <DataTable head={[{ label: "Publication" }, { label: "Type" }, { label: "Year", className: "text-right" }, { label: "Indexing" }, { label: "Dept" }, { label: "Status" }]} empty="No publications match.">
          {rows.map((p) => (
            <tr key={p.id}>
              <Td className="max-w-xl">
                <div className="font-medium">{p.title}</div>
                <div className="text-xs text-muted-foreground">{p.authorsText} · <i>{p.venue}</i>{p.volume ? ` ${p.volume}` : ""}{p.pages ? `, ${p.pages}` : ""}</div>
                {p.doi && <a className="text-xs text-primary hover:underline" href={`https://doi.org/${p.doi}`} target="_blank" rel="noopener noreferrer">doi:{p.doi}</a>}
              </Td>
              <Td className="text-xs">{PUBLICATION_TYPES[p.type]}</Td>
              <Td className="text-right tabular">{p.year}</Td>
              <Td className="text-xs">{INDEXING[p.indexing]}{p.impactFactor ? ` · IF ${p.impactFactor}` : ""}</Td>
              <Td className="text-xs">{p.department?.code ?? "—"}</Td>
              <Td className="text-xs">{p.verifiedAt ? "Verified" : manage && !p.authors.some((a) => a.employee.userId === ctx.user.id) ? <ActionButton size="xs" label="Verify" run={verifyPublicationAction.bind(null, p.id)} /> : "Awaiting verification"}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      <Pagination page={page} pageSize={pageSize} total={total} hrefFor={(n) => qs(base, { page: n })} />
    </div>
  );
}
