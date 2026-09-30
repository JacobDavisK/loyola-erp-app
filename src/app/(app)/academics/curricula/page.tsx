import Link from "next/link";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Curricula" };

const STATUS = { DRAFT: "Draft", ACTIVE: "Active", RETIRED: "Retired" } as const;

export default async function CurriculaPage() {
  const ctx = await requirePageAuth(["academic.view", "curriculum.manage"]);
  const rows = await db.curriculum.findMany({
    orderBy: [{ program: { code: "asc" } }, { version: "desc" }],
    include: { program: { select: { code: true, name: true } }, regulation: { select: { code: true } }, _count: { select: { courses: true, batches: true, groups: true } } },
  });
  return (
    <div>
      <PageHeader
        title="Curricula"
        description="Versioned programme structures used for degree audit. Active versions are frozen; changes are made in a new draft version so earlier cohorts keep their rules."
        actions={can(ctx, "curriculum.manage") && <Button asChild size="sm"><Link href="/academics/curricula/new"><Plus /> New curriculum</Link></Button>}
      />
      <Section bodyClassName="p-0">
        <DataTable head={[{ label: "Curriculum" }, { label: "Programme" }, { label: "Regulation" }, { label: "Credits", className: "text-right" }, { label: "Courses", className: "text-right" }, { label: "Batches", className: "text-right" }, { label: "Status" }, { label: "Updated" }]}>
          {rows.map((c) => (
            <tr key={c.id} className="hover:bg-muted/40">
              <Td><Link href={`/academics/curricula/${c.id}`} className="font-medium hover:text-primary">{c.name}</Link> <span className="text-xs text-muted-foreground">v{c.version}</span></Td>
              <Td className="text-xs">{c.program.code}</Td>
              <Td className="text-xs">{c.regulation.code}</Td>
              <Td className="text-right tabular">{c.totalCredits}</Td>
              <Td className="text-right tabular">{c._count.courses}</Td>
              <Td className="text-right tabular">{c._count.batches}</Td>
              <Td className="text-xs">{STATUS[c.status]}</Td>
              <Td className="text-xs whitespace-nowrap">{fmtDate(c.updatedAt)}</Td>
            </tr>
          ))}
        </DataTable>
        {rows.length === 0 && <p className="px-5 py-4 text-sm text-muted-foreground">No curricula defined.</p>}
      </Section>
    </div>
  );
}
