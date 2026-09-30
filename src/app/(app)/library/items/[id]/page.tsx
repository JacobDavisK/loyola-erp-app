import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/features/academic-ops/controls";
import { addCopiesAction, saveLibraryItemAction, setCopyStatusAction } from "@/features/campus/actions";
import { ITEM_FIELDS } from "@/features/campus/fields";
import { fmtDate } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Library title" };

export default async function LibraryItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth(["library.circulate", "library.manage"]);
  const item = await db.libraryItem.findUnique({
    where: { id },
    include: {
      copies: { orderBy: { accessionNo: "asc" }, include: { loans: { where: { returnedAt: null }, include: { student: { select: { studentNo: true, firstName: true, lastName: true } }, employee: { select: { employeeNo: true, firstName: true, lastName: true } } } } } },
      holds: { where: { fulfilledAt: null, cancelledAt: null }, orderBy: { createdAt: "asc" }, include: { student: { select: { studentNo: true, firstName: true, lastName: true } }, employee: { select: { employeeNo: true, firstName: true, lastName: true } } } },
    },
  });
  if (!item) notFound();
  const manage = can(ctx, "library.manage");
  const history = await db.libraryLoan.count({ where: { copy: { itemId: id } } });
  return (
    <div className="space-y-6">
      <PageHeader title={item.title} breadcrumbs={[{ label: "Library", href: "/library" }, { label: item.title }]} description={item.authors}
        actions={manage && <div className="flex gap-2"><FormDialog title="Catalogue item" columns={2} id={item.id} fields={ITEM_FIELDS} action={saveLibraryItemAction} initial={{ title: item.title, authors: item.authors, isbn: item.isbn, year: item.year, publisher: item.publisher, edition: item.edition, subject: item.subject, callNo: item.callNo }} trigger={<Button size="sm" variant="outline">Edit</Button>} /><FormDialog title="Copies" id={item.id} action={addCopiesAction} fields={[{ name: "count", label: "Number of copies", type: "number", min: 1, max: 100 }, { name: "location", label: "Shelf location", type: "text", optional: true }]} initial={{ count: 1 }} submitLabel="Add" trigger={<Button size="sm"><Plus /> Copies</Button>} /></div>} />
      <Section title="Details"><KeyValue items={[["ISBN", item.isbn ?? "—"], ["Publisher", item.publisher ?? "—"], ["Year", item.year ? String(item.year) : "—"], ["Subject", item.subject ?? "—"], ["Call number", item.callNo ?? "—"], ["Times borrowed", String(history)]]} /></Section>
      <Section title="Copies" bodyClassName="p-0">
        <DataTable head={[{ label: "Accession no." }, { label: "Location" }, { label: "Status" }, { label: "Borrower" }, { label: "Due" }, { label: "" }]} empty="No copies yet.">
          {item.copies.map((c) => {
            const l = c.loans[0];
            const who = l?.student ? `${l.student.firstName} ${l.student.lastName} (${l.student.studentNo})` : l?.employee ? `${l.employee.firstName} ${l.employee.lastName} (${l.employee.employeeNo})` : "—";
            return (
              <tr key={c.id}>
                <Td className="font-mono text-xs">{c.accessionNo}</Td>
                <Td className="text-xs">{c.location ?? "—"}</Td>
                <Td className="text-xs">{c.status.toLowerCase().replace("_", " ")}</Td>
                <Td className="text-xs">{who}</Td>
                <Td className={l && l.dueAt < new Date() ? "text-xs font-medium text-tone-danger" : "text-xs"}>{l ? fmtDate(l.dueAt) : "—"}</Td>
                <Td className="text-right">{manage && c.status === "AVAILABLE" && <ActionButton size="xs" variant="ghost" label="Withdraw" run={setCopyStatusAction.bind(null, c.id, "WITHDRAWN")} confirmText={`Withdraw ${c.accessionNo} from circulation?`} />}{manage && (c.status === "LOST" || c.status === "WITHDRAWN") && <ActionButton size="xs" variant="ghost" label="Restore" run={setCopyStatusAction.bind(null, c.id, "AVAILABLE")} />}</Td>
              </tr>
            );
          })}
        </DataTable>
      </Section>
      {item.holds.length > 0 && (
        <Section title="Hold queue">
          <ol className="list-decimal space-y-1 pl-5 text-sm">{item.holds.map((h) => <li key={h.id}>{h.student ? `${h.student.firstName} ${h.student.lastName} (${h.student.studentNo})` : `${h.employee!.firstName} ${h.employee!.lastName} (${h.employee!.employeeNo})`} <span className="text-xs text-muted-foreground">since {fmtDate(h.createdAt)}</span></li>)}</ol>
        </Section>
      )}
    </div>
  );
}
