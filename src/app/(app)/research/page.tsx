import Link from "next/link";
import type { Metadata } from "next";
import type { Prisma } from "@/generated/prisma/client";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section, StatCard } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { PROJECT_STATUS } from "@/features/quality/fields";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { projectWhere, publicationWhere } from "@/server/services/research";

export const metadata: Metadata = { title: "Research" };

export default async function ResearchPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requirePageAuth("research.view");
  const sp = await searchParams;
  const scope = projectWhere(ctx);
  const where: Prisma.ResearchProjectWhereInput = { AND: [scope, sp.status && sp.status in PROJECT_STATUS ? { status: sp.status as keyof typeof PROJECT_STATUS } : {}] };
  const year = new Date().getUTCFullYear();
  const [projects, running, sanctioned, pubs, unverified, inst] = await Promise.all([
    db.researchProject.findMany({ where, orderBy: [{ updatedAt: "desc" }], take: 100, include: { department: { select: { code: true } }, members: { where: { role: "PI" }, include: { employee: { select: { firstName: true, lastName: true } } } } } }),
    db.researchProject.count({ where: { AND: [scope, { status: "SANCTIONED" }] } }),
    db.researchProject.aggregate({ where: { AND: [scope, { status: { in: ["SANCTIONED", "COMPLETED"] } }] }, _sum: { sanctionedAmount: true } }),
    db.publication.count({ where: { AND: [publicationWhere(ctx), { year, verifiedAt: { not: null } }] } }),
    db.publication.count({ where: { AND: [publicationWhere(ctx), { verifiedAt: null }] } }),
    db.institution.findFirstOrThrow({ select: { currency: true, locale: true } }),
  ]);
  const fmt = (x: { toString(): string } | null) => formatMoney(toMinor(x), inst.currency, inst.locale);
  return (
    <div className="space-y-6">
      <PageHeader title="Research" breadcrumbs={[{ label: "Research & quality" }, { label: "Research" }]} description="Sponsored projects from proposal to completion. Faculty propose projects and add publications from My research." />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        <StatCard label="Running projects" value={running} href="?status=SANCTIONED" />
        <StatCard label="Grants sanctioned (all time)" value={fmt(sanctioned._sum.sanctionedAmount)} />
        <StatCard label={`Verified publications ${year}`} value={pubs} href="/research/publications" />
        <StatCard label="Publications to verify" value={unverified} tone={unverified ? "warning" : undefined} href="/research/publications?verified=no" />
      </div>
      <form className="flex gap-2">
        <select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="h-8 rounded-lg border bg-card px-2 text-[13px]"><option value="">All projects</option>{Object.entries(PROJECT_STATUS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select>
        <button className="h-8 rounded-lg border px-3 text-[13px] hover:bg-muted">Apply</button>
      </form>
      <Section title="Projects" bodyClassName="p-0">
        <DataTable head={[{ label: "Project" }, { label: "PI" }, { label: "Dept" }, { label: "Agency" }, { label: "Amount", className: "text-right" }, { label: "Status" }]} empty="No projects.">
          {projects.map((p) => (
            <tr key={p.id}>
              <Td><Link className="font-medium hover:text-primary" href={`/research/projects/${p.id}`}>{p.title}</Link><div className="font-mono text-[11px] text-muted-foreground">{p.code}</div></Td>
              <Td className="text-xs">{p.members[0] ? `${p.members[0].employee.firstName} ${p.members[0].employee.lastName}` : "—"}</Td>
              <Td className="text-xs">{p.department?.code ?? "—"}</Td>
              <Td className="max-w-56 text-xs"><span className="line-clamp-2">{p.fundingAgency}</span></Td>
              <Td className="text-right tabular">{fmt(p.sanctionedAmount ?? p.proposedAmount)}</Td>
              <Td><StatusBadge meta={PROJECT_STATUS[p.status]} /></Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
