import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { ActionButton } from "@/features/academic-ops/controls";
import { cancelHoldAction, renewLoanAction } from "@/features/campus/actions";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { fmtDate } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "My library" };

export default async function MyLibraryPage() {
  const ctx = await requirePageAuth();
  const who = ctx.subject.studentId ? { studentId: ctx.subject.studentId } : ctx.subject.employeeId ? { employeeId: ctx.subject.employeeId } : null;
  if (!who) redirect("/library");
  const [loans, holds, inst] = await Promise.all([
    db.libraryLoan.findMany({ where: who, orderBy: [{ returnedAt: { sort: "desc", nulls: "first" } }, { dueAt: "asc" }], take: 50, include: { copy: { include: { item: { select: { title: true, authors: true } } } } } }),
    db.libraryHold.findMany({ where: { ...who, fulfilledAt: null, cancelledAt: null }, include: { item: { select: { title: true } } } }),
    db.institution.findFirstOrThrow({ select: { currency: true, locale: true } }),
  ]);
  const now = new Date();
  const open = loans.filter((l) => !l.returnedAt);
  const past = loans.filter((l) => l.returnedAt);
  return (
    <div className="space-y-6">
      <PageHeader title="My library" breadcrumbs={[{ label: "Library", href: "/library" }, { label: "My loans" }]} description="Items you have borrowed and titles you are waiting for. Renew online before the due date if nobody is waiting." />
      <Section title={`On loan (${open.length})`} bodyClassName="p-0">
        <DataTable head={[{ label: "Title" }, { label: "Accession" }, { label: "Due" }, { label: "Renewals", className: "text-right" }, { label: "" }]} empty="Nothing on loan.">
          {open.map((l) => (
            <tr key={l.id}>
              <Td>{l.copy.item.title}<div className="text-xs text-muted-foreground">{l.copy.item.authors}</div></Td>
              <Td className="font-mono text-xs">{l.copy.accessionNo}</Td>
              <Td className={l.dueAt < now ? "text-xs font-medium text-tone-danger" : "text-xs"}>{fmtDate(l.dueAt)}{l.dueAt < now ? " · overdue" : ""}</Td>
              <Td className="text-right tabular">{l.renewals}</Td>
              <Td className="text-right">{l.dueAt >= now && <ActionButton size="xs" label="Renew" run={renewLoanAction.bind(null, l.id)} />}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      {holds.length > 0 && (
        <Section title="Holds">
          <ul className="space-y-1 text-sm">{holds.map((h) => <li key={h.id} className="flex items-center gap-2">{h.item.title} <ActionButton size="xs" variant="ghost" label="Cancel" run={cancelHoldAction.bind(null, h.id)} /></li>)}</ul>
        </Section>
      )}
      <Section title="History" bodyClassName="p-0">
        <DataTable head={[{ label: "Title" }, { label: "Borrowed" }, { label: "Returned" }, { label: "Fine", className: "text-right" }]} empty="No returned items.">
          {past.map((l) => (
            <tr key={l.id}>
              <Td>{l.copy.item.title}</Td>
              <Td className="text-xs">{fmtDate(l.issuedAt)}</Td>
              <Td className="text-xs">{fmtDate(l.returnedAt)}</Td>
              <Td className="text-right tabular">{toMinor(l.fineAmount) ? formatMoney(toMinor(l.fineAmount), inst.currency, inst.locale) : "—"}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
