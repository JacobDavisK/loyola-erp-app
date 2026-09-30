import Link from "next/link";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, SearchForm, Td } from "@/components/app/list";
import { PageHeader, Section, StatCard } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/features/academic-ops/controls";
import { placeHoldAction, saveLibraryItemAction } from "@/features/campus/actions";
import { CirculationDesk } from "@/features/campus/controls";
import { ITEM_FIELDS } from "@/features/campus/fields";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { searchCatalogue } from "@/server/services/library";

export const metadata: Metadata = { title: "Library" };


export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requirePageAuth();
  const { q = "" } = await searchParams;
  const circulate = can(ctx, "library.circulate");
  const manage = can(ctx, "library.manage");
  const now = new Date();
  const [items, onLoan, overdue, holds] = await Promise.all([
    searchCatalogue(q, 60),
    circulate ? db.libraryLoan.count({ where: { returnedAt: null } }) : 0,
    circulate ? db.libraryLoan.count({ where: { returnedAt: null, dueAt: { lt: now } } }) : 0,
    circulate ? db.libraryHold.count({ where: { fulfilledAt: null, cancelledAt: null } }) : 0,
  ]);
  const reader = !!(ctx.subject.studentId || ctx.subject.employeeId);
  return (
    <div className="space-y-6">
      <PageHeader title="Library" description="Search the catalogue. Readers can place a hold on titles with no copy on the shelf." actions={<div className="flex gap-2">{reader && <Button asChild size="sm" variant="outline"><Link href="/library/my">My loans</Link></Button>}{manage && <FormDialog title="Catalogue item" columns={2} fields={ITEM_FIELDS} action={saveLibraryItemAction} trigger={<Button size="sm"><Plus /> Title</Button>} />}</div>} />
      {circulate && (
        <>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
            <StatCard label="On loan" value={onLoan} />
            <StatCard label="Overdue" value={overdue} tone={overdue ? "warning" : undefined} href="/library/overdue" />
            <StatCard label="Holds waiting" value={holds} />
          </div>
          <Section title="Circulation desk"><CirculationDesk canWaive={manage} /></Section>
        </>
      )}
      <div className="flex justify-end"><SearchForm defaultValue={q} placeholder="Title, author, ISBN or subject" /></div>
      <Section title={q ? `Results for “${q}”` : "Catalogue"} bodyClassName="p-0">
        <DataTable head={[{ label: "Title" }, { label: "Call no." }, { label: "Available", className: "text-right" }, { label: "" }]} empty="No titles match.">
          {items.map((i) => (
            <tr key={i.id}>
              <Td>{manage || circulate ? <Link className="font-medium hover:text-primary" href={`/library/items/${i.id}`}>{i.title}</Link> : <span className="font-medium">{i.title}</span>}<div className="text-xs text-muted-foreground">{i.authors}{i.year ? ` · ${i.year}` : ""}{i.isbn ? ` · ISBN ${i.isbn}` : ""}</div></Td>
              <Td className="font-mono text-xs">{i.callNo ?? "—"}</Td>
              <Td className="text-right tabular">{i.available} / {i.total}{i.holds ? <div className="text-[11px] text-muted-foreground">{i.holds} waiting</div> : null}</Td>
              <Td className="text-right">{reader && i.available === 0 && i.total > 0 && <ActionButton size="xs" label="Place hold" run={placeHoldAction.bind(null, i.id)} />}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
