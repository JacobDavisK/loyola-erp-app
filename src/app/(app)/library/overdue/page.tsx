import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { daysLate } from "@/lib/domain/campus";
import { fmtDate } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { getSetting } from "@/server/services/settings";

export const metadata: Metadata = { title: "Overdue items" };

export default async function OverduePage() {
  await requirePageAuth("library.circulate");
  const now = new Date();
  const [loans, cfg] = await Promise.all([
    db.libraryLoan.findMany({ where: { returnedAt: null, dueAt: { lt: now } }, orderBy: { dueAt: "asc" }, include: { copy: { include: { item: { select: { title: true } } } }, student: { select: { studentNo: true, firstName: true, lastName: true, phone: true } }, employee: { select: { employeeNo: true, firstName: true, lastName: true, phone: true } } } }),
    getSetting("library"),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Overdue items" breadcrumbs={[{ label: "Library", href: "/library" }, { label: "Overdue" }]} description={`Borrowers are reminded automatically. Fine: ${cfg.finePerDay.toFixed(2)} a day${cfg.fineCap ? `, at most ${cfg.fineCap.toFixed(2)}` : ""}.`} />
      <Section title={`${loans.length} item(s)`} bodyClassName="p-0">
        <DataTable head={[{ label: "Borrower" }, { label: "Title" }, { label: "Accession" }, { label: "Due" }, { label: "Days late", className: "text-right" }, { label: "Fine so far", className: "text-right" }]} empty="Nothing is overdue.">
          {loans.map((l) => {
            const b = l.student ? { n: l.student.studentNo, name: `${l.student.firstName} ${l.student.lastName}`, phone: l.student.phone } : { n: l.employee!.employeeNo, name: `${l.employee!.firstName} ${l.employee!.lastName}`, phone: l.employee!.phone };
            const late = daysLate(l.dueAt, now);
            return (
              <tr key={l.id}>
                <Td>{b.name}<div className="font-mono text-[11px] text-muted-foreground">{b.n}{b.phone ? ` · ${b.phone}` : ""}</div></Td>
                <Td className="text-sm">{l.copy.item.title}</Td>
                <Td className="font-mono text-xs">{l.copy.accessionNo}</Td>
                <Td className="text-xs">{fmtDate(l.dueAt)}</Td>
                <Td className="text-right tabular">{late}</Td>
                <Td className="text-right tabular">{Math.min(late * cfg.finePerDay, cfg.fineCap || Infinity).toFixed(2)}</Td>
              </tr>
            );
          })}
        </DataTable>
      </Section>
    </div>
  );
}
