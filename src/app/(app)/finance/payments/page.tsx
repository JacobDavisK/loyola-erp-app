import Link from "next/link";
import { Wallet } from "lucide-react";
import type { Metadata } from "next";
import type { Prisma } from "@/generated/prisma/client";
import { DataGrid, type GridColumn } from "@/components/app/data-grid";
import { SearchForm } from "@/components/app/list";
import { EmptyState, PageHeader } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { PAYMENT_METHOD_LABEL, PAYMENT_STATUS } from "@/lib/domain/labels";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { fmtDateTime } from "@/lib/format";
import { requirePageAuth, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageAuth("finance.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = 40;
  const scope = scopeOf(ctx, "finance.view");
  const and: Prisma.PaymentWhereInput[] = [scope === null ? {} : { student: { departmentId: { in: scope } } }];
  if (sp.status && sp.status in PAYMENT_STATUS) and.push({ status: sp.status as keyof typeof PAYMENT_STATUS });
  if (sp.method && sp.method in PAYMENT_METHOD_LABEL) and.push({ method: sp.method as keyof typeof PAYMENT_METHOD_LABEL });
  if (sp.from) and.push({ receivedAt: { gte: new Date(sp.from) } });
  if (sp.to) and.push({ receivedAt: { lt: new Date(new Date(sp.to).getTime() + 86_400_000) } });
  if (sp.q) and.push({ OR: [{ receiptNo: { contains: sp.q, mode: "insensitive" } }, { reference: { contains: sp.q, mode: "insensitive" } }, { student: { studentNo: { contains: sp.q, mode: "insensitive" } } }] });
  const where = { AND: and };
  const [rows, total, sum, inst] = await Promise.all([
    db.payment.findMany({ where, orderBy: { receivedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { student: { select: { id: true, studentNo: true, firstName: true, lastName: true } } } }),
    db.payment.count({ where }),
    db.payment.aggregate({ where: { AND: [...and, { status: "SUCCEEDED" }] }, _sum: { amount: true } }),
    db.institution.findFirstOrThrow({ select: { currency: true, locale: true } }),
  ]);
  const fmt = (m: number) => formatMoney(m, inst.currency, inst.locale);
  const columns: GridColumn[] = [
    { key: "receipt", label: "Receipt", pinned: true },
    { key: "student", label: "Student" },
    { key: "method", label: "Method" },
    { key: "amount", label: "Amount", className: "text-right" },
    { key: "status", label: "Status" },
    { key: "when", label: "Received" },
  ];
  return (
    <div>
      <PageHeader title="Payments" breadcrumbs={[{ label: "Finance", href: "/finance" }, { label: "Payments" }]} description={`${total} payment(s) · received ${fmt(toMinor(sum._sum.amount))} in this view`} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form className="flex flex-wrap items-center gap-2">
          <select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="h-8 rounded-lg border bg-card px-2 text-[13px]"><option value="">Any status</option>{Object.entries(PAYMENT_STATUS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select>
          <select name="method" defaultValue={sp.method ?? ""} aria-label="Method" className="h-8 rounded-lg border bg-card px-2 text-[13px]"><option value="">Any method</option>{Object.entries(PAYMENT_METHOD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <label className="text-[13px]">From <input type="date" name="from" defaultValue={sp.from} className="h-8 rounded-lg border bg-card px-2" /></label>
          <label className="text-[13px]">To <input type="date" name="to" defaultValue={sp.to} className="h-8 rounded-lg border bg-card px-2" /></label>
          <button className="h-8 rounded-lg border px-3 text-[13px] hover:bg-muted">Apply</button>
        </form>
        <div className="ml-auto"><SearchForm defaultValue={sp.q} placeholder="Receipt, reference or student no." hidden={{ status: sp.status, method: sp.method, from: sp.from, to: sp.to }} /></div>
      </div>
      <DataGrid
        gridKey="payments"
        columns={columns}
        total={total}
        page={page}
        pageSize={pageSize}
        empty={<EmptyState icon={Wallet} title="No payments" />}
        rows={rows.map((p) => ({
          id: p.id,
          cells: {
            receipt: <Link href={`/finance/payments/${p.id}`} className="font-mono text-xs hover:text-primary">{p.receiptNo ?? p.gatewayOrderId ?? "—"}</Link>,
            student: <Link href={`/students/${p.student.id}?tab=fees`} className="hover:text-primary">{p.student.firstName} {p.student.lastName}<span className="block font-mono text-[11px] text-muted-foreground">{p.student.studentNo}</span></Link>,
            method: <span className="text-xs">{PAYMENT_METHOD_LABEL[p.method]}{p.reference ? ` · ${p.reference}` : ""}</span>,
            amount: <span className="tabular">{fmt(toMinor(p.amount))}</span>,
            status: <StatusBadge meta={PAYMENT_STATUS[p.status]} />,
            when: <span className="text-xs whitespace-nowrap">{fmtDateTime(p.receivedAt)}</span>,
          },
        }))}
      />
    </div>
  );
}
