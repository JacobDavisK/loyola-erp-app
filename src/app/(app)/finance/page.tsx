import Link from "next/link";
import { AlertTriangle, Banknote, FileText, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section, StatCard } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { CollectionsChart } from "@/features/finance/charts";
import { PAYMENT_METHOD_LABEL, PAYMENT_STATUS } from "@/lib/domain/labels";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { fmtDateTime } from "@/lib/format";
import { can, hasGlobal, requirePageAuth, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";
import { onlinePaymentsEnabled } from "@/server/payments/gateway";
import { currentTerm } from "@/server/services/academic-setup";
import { invoiceWhere } from "@/server/services/finance";

export const metadata: Metadata = { title: "Finance" };

export default async function FinanceDashboard() {
  const ctx = await requirePageAuth("finance.view");
  const global = hasGlobal(ctx, "finance.view");
  const [where, term, inst] = await Promise.all([invoiceWhere(ctx), currentTerm(), db.institution.findFirstOrThrow({ select: { currency: true, locale: true, timezone: true } })]);
  const since = new Date(new Date().getTime() - 30 * 86_400_000);
  const [termAgg, overdue, recent, daily, byDept] = await Promise.all([
    db.invoice.aggregate({ where: { AND: [where, { cancelledAt: null }, term ? { termId: term.id } : {}] }, _sum: { total: true, amountPaid: true, concession: true }, _count: { _all: true } }),
    db.invoice.aggregate({ where: { AND: [where, { status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: new Date() } }] }, _count: { _all: true }, _sum: { total: true, amountPaid: true } }),
    db.payment.findMany({ where: global ? {} : { student: { departmentId: { in: scopeOf(ctx, "finance.view") ?? [] } } }, orderBy: { receivedAt: "desc" }, take: 10, include: { student: { select: { id: true, firstName: true, lastName: true, studentNo: true } } } }),
    global ? db.$queryRaw<{ day: Date; amount: string }[]>`SELECT date_trunc('day', "receivedAt") AS day, SUM("amount")::text AS amount FROM "Payment" WHERE "status" = 'SUCCEEDED' AND "receivedAt" >= ${since} GROUP BY 1 ORDER BY 1` : Promise.resolve([]),
    !global ? Promise.resolve([] as { code: string; billed: string; paid: string }[]) : db.$queryRaw<{ code: string; billed: string; paid: string }[]>`
      SELECT d."code", SUM(i."total")::text AS billed, SUM(i."amountPaid")::text AS paid
      FROM "Invoice" i JOIN "Student" s ON s."id" = i."studentId" JOIN "Department" d ON d."id" = s."departmentId"
      WHERE i."cancelledAt" IS NULL AND (${term?.id ?? null}::text IS NULL OR i."termId" = ${term?.id ?? null}) GROUP BY d."code" ORDER BY d."code"`,
  ]);
  const billed = toMinor(termAgg._sum.total);
  const collected = toMinor(termAgg._sum.amountPaid);
  const fmt = (m: number) => formatMoney(m, inst.currency, inst.locale);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance"
        description={`${term ? `${term.name} · ` : ""}fees, collections and balances. Online payment is ${onlinePaymentsEnabled() ? "enabled" : "not configured — counter collections only"}.`}
        actions={
          <>
            <Button asChild size="sm" variant="outline"><Link href="/finance/invoices">Invoices</Link></Button>
            <Button asChild size="sm" variant="outline"><Link href="/finance/payments">Payments</Link></Button>
            {can(ctx, "fee.manage") && <Button asChild size="sm" variant="outline"><Link href="/finance/setup">Fee setup</Link></Button>}
            {can(ctx, "scholarship.manage") && <Button asChild size="sm" variant="outline"><Link href="/finance/scholarships">Scholarships</Link></Button>}
            {can(ctx, "ledger.manage") && <Button asChild size="sm" variant="outline"><Link href="/finance/ledger">Ledger</Link></Button>}
          </>
        }
      />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
        <StatCard label="Billed this term" value={fmt(billed)} icon={FileText} hint={`${termAgg._count._all} invoices`} />
        <StatCard label="Collected" value={fmt(collected)} icon={Wallet} tone="success" hint={billed ? `${Math.round((collected / billed) * 100)}% collection rate` : undefined} />
        <StatCard label="Outstanding" value={fmt(billed - collected)} icon={Banknote} hint={`Concessions ${fmt(toMinor(termAgg._sum.concession))}`} />
        <StatCard label="Overdue invoices" value={overdue._count._all} icon={AlertTriangle} tone={overdue._count._all ? "danger" : undefined} hint={fmt(toMinor(overdue._sum.total) - toMinor(overdue._sum.amountPaid))} href="/finance/invoices?overdue=1" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Section title="Collections — last 30 days">
          <CollectionsChart data={daily.map((d) => ({ day: d.day.toISOString().slice(0, 10), amount: Number(d.amount) }))} currency={inst.currency} />
        </Section>
        <Section title="By department" bodyClassName="p-0">
          <DataTable head={[{ label: "Dept" }, { label: "Billed", className: "text-right" }, { label: "Collected", className: "text-right" }, { label: "Rate", className: "text-right" }]}>
            {byDept.map((d) => (
              <tr key={d.code}>
                <Td className="text-xs font-medium">{d.code}</Td>
                <Td className="text-right text-xs tabular">{fmt(toMinor(d.billed))}</Td>
                <Td className="text-right text-xs tabular">{fmt(toMinor(d.paid))}</Td>
                <Td className="text-right text-xs tabular">{toMinor(d.billed) ? Math.round((toMinor(d.paid) / toMinor(d.billed)) * 100) : 0}%</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      </div>
      <Section title="Latest payments" bodyClassName="p-0">
        <DataTable head={[{ label: "Receipt" }, { label: "Student" }, { label: "Method" }, { label: "Amount", className: "text-right" }, { label: "Status" }, { label: "Received" }]}>
          {recent.map((p) => (
            <tr key={p.id}>
              <Td><Link href={`/finance/payments/${p.id}`} className="font-mono text-xs hover:text-primary">{p.receiptNo ?? "—"}</Link></Td>
              <Td className="text-sm">{p.student.firstName} {p.student.lastName}<div className="font-mono text-[11px] text-muted-foreground">{p.student.studentNo}</div></Td>
              <Td className="text-xs">{PAYMENT_METHOD_LABEL[p.method]}</Td>
              <Td className="text-right tabular">{fmt(toMinor(p.amount))}</Td>
              <Td><StatusBadge meta={PAYMENT_STATUS[p.status]} /></Td>
              <Td className="text-xs whitespace-nowrap">{fmtDateTime(p.receivedAt)}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
