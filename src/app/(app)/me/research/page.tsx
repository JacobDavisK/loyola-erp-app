import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/features/academic-ops/controls";
import { deletePublicationAction, savePublicationAction, saveProjectAction } from "@/features/quality/actions";
import { INDEXING, PROJECT_FIELDS, PROJECT_STATUS, PUBLICATION_TYPES, publicationFields } from "@/features/quality/fields";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "My research" };

export default async function MyResearchPage() {
  const ctx = await requirePageAuth();
  const me = ctx.subject.employeeId;
  if (!me) redirect("/dashboard");
  const [projects, pubs, inst] = await Promise.all([
    db.researchProject.findMany({ where: { members: { some: { employeeId: me } } }, orderBy: { createdAt: "desc" }, include: { members: { where: { employeeId: me } } } }),
    db.publication.findMany({ where: { authors: { some: { employeeId: me } } }, orderBy: [{ year: "desc" }, { createdAt: "desc" }], include: { authors: { orderBy: { position: "asc" }, include: { employee: { select: { employeeNo: true } } } } } }),
    db.institution.findFirstOrThrow({ select: { currency: true, locale: true } }),
  ]);
  const fmt = (x: { toString(): string } | null) => formatMoney(toMinor(x), inst.currency, inst.locale);
  const pubFields = publicationFields(projects.map((p) => ({ id: p.id, label: `${p.code} — ${p.title}` })));
  return (
    <div className="space-y-6">
      <PageHeader title="My research" breadcrumbs={[{ label: "My work" }, { label: "Research" }]} description="Your sponsored projects and publications. Proposals need institutional clearance before they go to the agency; publications are verified by the research office." />
      <Section title="Projects" actions={<FormDialog title="Research proposal" columns={2} fields={PROJECT_FIELDS} action={saveProjectAction} initial={{ durationMonths: 24 }} trigger={<Button size="xs"><Plus /> Proposal</Button>} />} bodyClassName="p-0">
        <DataTable head={[{ label: "Project" }, { label: "Role" }, { label: "Agency" }, { label: "Amount", className: "text-right" }, { label: "Status" }]} empty="No projects yet.">
          {projects.map((p) => (
            <tr key={p.id}>
              <Td><Link className="font-medium hover:text-primary" href={`/research/projects/${p.id}`}>{p.title}</Link><div className="font-mono text-[11px] text-muted-foreground">{p.code}</div></Td>
              <Td className="text-xs">{p.members[0]?.role === "PI" ? "PI" : p.members[0]?.role === "CO_PI" ? "Co-PI" : "Member"}</Td>
              <Td className="text-xs">{p.fundingAgency}</Td>
              <Td className="text-right tabular">{fmt(p.sanctionedAmount ?? p.proposedAmount)}</Td>
              <Td><StatusBadge meta={PROJECT_STATUS[p.status]} /></Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      <Section title="Publications" actions={<FormDialog title="Publication" columns={2} fields={pubFields} action={savePublicationAction} initial={{ type: "JOURNAL", indexing: "NONE", year: new Date().getFullYear() }} trigger={<Button size="xs"><Plus /> Publication</Button>} />} bodyClassName="p-0">
        <DataTable head={[{ label: "Publication" }, { label: "Year", className: "text-right" }, { label: "Indexing" }, { label: "Status" }, { label: "" }]} empty="No publications yet.">
          {pubs.map((p) => (
            <tr key={p.id}>
              <Td className="max-w-xl"><div className="font-medium">{p.title}</div><div className="text-xs text-muted-foreground">{PUBLICATION_TYPES[p.type]} · {p.venue}{p.doi ? ` · doi:${p.doi}` : ""}</div></Td>
              <Td className="text-right tabular">{p.year}</Td>
              <Td className="text-xs">{INDEXING[p.indexing]}</Td>
              <Td className="text-xs">{p.verifiedAt ? "Verified" : "Awaiting verification"}</Td>
              <Td className="text-right">
                {!p.verifiedAt && (
                  <div className="flex justify-end gap-1">
                    <FormDialog title="Publication" columns={2} id={p.id} fields={pubFields} action={savePublicationAction}
                      initial={{ type: p.type, year: p.year, title: p.title, venue: p.venue, authorsText: p.authorsText, coAuthors: p.authors.filter((a) => a.employeeId !== me).map((a) => a.employee.employeeNo).join(", "), doi: p.doi, indexing: p.indexing, volume: p.volume, pages: p.pages, impactFactor: p.impactFactor, isbn: p.isbn, url: p.url, projectId: p.projectId }} />
                    <ActionButton size="xs" variant="ghost" label="" ariaLabel="Delete publication" icon={<Trash2 />} run={deletePublicationAction.bind(null, p.id)} confirmText="Delete this publication?" />
                  </div>
                )}
              </Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
