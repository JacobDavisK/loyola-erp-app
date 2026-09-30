import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import type { Metadata } from "next";
import type { Prisma } from "@/generated/prisma/client";
import { DataGrid, type GridColumn } from "@/components/app/data-grid";
import { FormDialog, type FormField } from "@/components/app/form-dialog";
import { SearchForm } from "@/components/app/list";
import { EmptyState, PageHeader } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { generateTermInvoicesAction } from "@/features/finance/actions";
import { INVOICE_STATUS } from "@/lib/domain/labels";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { fmtDate } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { invoiceWhere } from "@/server/services/finance";

export const metadata: Metadata = { title: "Invoices" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageAuth("finance.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = 30;
  const and: Prisma.InvoiceWhereInput[] = [await invoiceWhere(ctx)];
  if (sp.status && sp.status in INVOICE_STATUS) and.push({ status: sp.status as keyof typeof INVOICE_STATUS });
  if (sp.overdue) and.push({ status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: new Date() } });
  if (sp.batch) and.push({ student: { batchId: sp.batch } });
  if (sp.term) and.push({ termId: sp.term });
  if (sp.q) and.push({ OR: [{ number: { contains: sp.q, mode: "insensitive" } }, { student: { studentNo: { contains: sp.q, mode: "insensitive" } } }, { student: { lastName: { contains: sp.q, mode: "insensitive" } } }, { student: { firstName: { contains: sp.q, mode: "insensitive" } } }] });
  const where = { AND: and };
  const order: Prisma.InvoiceOrderByWithRelationInput[] = sp.sort === "due" ? [{ dueDate: "asc" }] : sp.sort === "-total" ? [{ total: "desc" }] : [{ issueDate: "desc" }, { number: "desc" }];
  const [rows, total, sums, batches, terms, structures, inst] = await Promise.all([
    db.invoice.findMany({ where, orderBy: order, skip: (page - 1) * pageSize, take: pageSize, include: { student: { select: { id: true, studentNo: true, firstName: true, lastName: true, batch: { select: { code: true } } } } } }),
    db.invoice.count({ where }),
    db.invoice.aggregate({ where, _sum: { total: true, amountPaid: true } }),
    db.batch.findMany({ where: { deletedAt: null }, orderBy: [{ admissionYear: "desc" }, { code: "asc" }], select: { id: true, code: true } }),
    db.academicTerm.findMany({ orderBy: { startDate: "desc" }, take: 8 }),
    db.feeStructure.findMany({ where: { status: "ACTIVE" }, orderBy: { code: "asc" } }),
    db.institution.findFirstOrThrow({ select: { currency: true, locale: true } }),
  ]);
  const fmt = (m: number) => formatMoney(m, inst.currency, inst.locale);
  const genFields: FormField[] = [
    { name: "structureId", label: "Fee structure (active)", type: "select", options: structures.map((s) => ({ value: s.id, label: `${s.code} v${s.version} — ${s.name}` })) },
    { name: "termId", label: "Term", type: "select", options: terms.map((t) => ({ value: t.id, label: t.name })) },
    { name: "batchId", label: "Batch", type: "select", options: batches.map((b) => ({ value: b.id, label: b.code })) },
    { name: "section", label: "Section", type: "text", optional: true },
  ];
  const columns: GridColumn[] = [
    { key: "number", label: "Invoice", pinned: true },
    { key: "student", label: "Student", pinned: true },
    { key: "batch", label: "Batch" },
    { key: "due", label: "Due", sort: "due" },
    { key: "total", label: "Total", sort: "-total", className: "text-right" },
    { key: "balance", label: "Balance", className: "text-right" },
    { key: "status", label: "Status" },
    { key: "issued", label: "Issued", hidden: true },
  ];
  return (
    <div>
      <PageHeader
        title="Invoices"
        breadcrumbs={[{ label: "Finance", href: "/finance" }, { label: "Invoices" }]}
        description={`${total} invoice(s) · billed ${fmt(toMinor(sums._sum.total))} · outstanding ${fmt(toMinor(sums._sum.total) - toMinor(sums._sum.amountPaid))}`}
        actions={can(ctx, "invoice.manage") && structures.length > 0 && <FormDialog title="Term invoices" description="Raises one invoice per active student of the batch from the structure's lines that apply to their semester. Students already invoiced from this structure for the term are skipped." fields={genFields} action={generateTermInvoicesAction} submitLabel="Generate" trigger={<Button size="sm"><Plus /> Generate term invoices</Button>} />}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form className="flex flex-wrap gap-2">
          <select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="h-8 rounded-lg border bg-card px-2 text-[13px]"><option value="">Any status</option>{Object.entries(INVOICE_STATUS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select>
          <select name="term" defaultValue={sp.term ?? ""} aria-label="Term" className="h-8 rounded-lg border bg-card px-2 text-[13px]"><option value="">Any term</option>{terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <select name="batch" defaultValue={sp.batch ?? ""} aria-label="Batch" className="h-8 rounded-lg border bg-card px-2 text-[13px]"><option value="">All batches</option>{batches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</select>
          <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" name="overdue" value="1" defaultChecked={!!sp.overdue} className="accent-[var(--primary)]" /> Overdue only</label>
          <button className="h-8 rounded-lg border px-3 text-[13px] hover:bg-muted">Apply</button>
        </form>
        <div className="ml-auto"><SearchForm defaultValue={sp.q} placeholder="Invoice, student no. or name" hidden={{ status: sp.status, term: sp.term, batch: sp.batch, overdue: sp.overdue }} /></div>
      </div>
      <DataGrid
        gridKey="invoices"
        columns={columns}
        total={total}
        page={page}
        pageSize={pageSize}
        savedViews={(await db.savedFilter.findMany({ where: { userId: ctx.user.id, scope: "invoices" } })).map((v) => ({ id: v.id, name: v.name, query: v.query as Record<string, string> }))}
        empty={<EmptyState icon={FileText} title="No invoices" />}
        rows={rows.map((i) => {
          const balance = toMinor(i.total) - toMinor(i.amountPaid);
          const overdue = balance > 0 && !i.cancelledAt && i.dueDate < new Date();
          return {
            id: i.id,
            cells: {
              number: <Link href={`/finance/invoices/${i.id}`} className="font-mono text-xs hover:text-primary">{i.number}</Link>,
              student: <Link href={`/students/${i.student.id}?tab=fees`} className="hover:text-primary">{i.student.firstName} {i.student.lastName}<span className="block font-mono text-[11px] text-muted-foreground">{i.student.studentNo}</span></Link>,
              batch: <span className="text-xs">{i.student.batch.code}</span>,
              due: <span className={overdue ? "text-xs font-medium text-tone-danger" : "text-xs"}>{fmtDate(i.dueDate)}{overdue ? " · overdue" : ""}</span>,
              total: <span className="tabular">{fmt(toMinor(i.total))}</span>,
              balance: <span className="tabular">{fmt(balance)}</span>,
              status: <StatusBadge meta={INVOICE_STATUS[i.status]} />,
              issued: <span className="text-xs">{fmtDate(i.issueDate)}</span>,
            },
          };
        })}
      />
    </div>
  );
}
