import Link from "next/link";
import { GraduationCap, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { FormDialog } from "@/components/app/form-dialog";
import { EmptyState, PageHeader, Section, StatCard } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { applyScholarshipFormAction } from "@/features/finance/actions";
import { PayOnlineButton } from "@/features/finance/controls";
import { INVOICE_STATUS, PAYMENT_METHOD_LABEL, PAYMENT_STATUS } from "@/lib/domain/labels";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { fmtDate } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { onlinePaymentsEnabled } from "@/server/payments/gateway";
import { portalSubject } from "@/server/services/portal";
import { getT } from "@/server/i18n";

export const metadata: Metadata = { title: "Fees" };

export default async function PortalFeesPage({ searchParams }: { searchParams: Promise<{ student?: string }> }) {
  const ctx = await requirePageAuth("self.portal");
  const t = await getT();
  const sp = await searchParams;
  const subject = await portalSubject(ctx, sp.student);
  if (!subject.canFinance) return <div><PageHeader title={t("Fees")} /><EmptyState icon={Wallet} title="Fee information is not shared with this account" /></div>;
  const s = subject.student;
  const now = new Date();
  const [invoices, payments, schemes, apps, inst] = await Promise.all([
    db.invoice.findMany({ where: { studentId: s.id }, orderBy: { issueDate: "desc" }, take: 50 }),
    db.payment.findMany({ where: { studentId: s.id, status: { in: ["SUCCEEDED", "REVERSED"] } }, orderBy: { receivedAt: "desc" }, take: 30 }),
    subject.isSelf && can(ctx, "scholarship.apply") ? db.scholarshipScheme.findMany({ where: { status: "OPEN", OR: [{ closesAt: null }, { closesAt: { gte: now } }] }, orderBy: { name: "asc" } }) : [],
    db.scholarshipApplication.findMany({ where: { studentId: s.id }, include: { scheme: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
    db.institution.findFirstOrThrow({ select: { currency: true, locale: true } }),
  ]);
  const fmt = (m: number) => formatMoney(m, inst.currency, inst.locale);
  const open = invoices.filter((i) => i.status === "ISSUED" || i.status === "PARTIALLY_PAID");
  const outstanding = open.reduce((a, i) => a + toMinor(i.total) - toMinor(i.amountPaid), 0);
  const overdue = open.filter((i) => i.dueDate < now);
  const online = onlinePaymentsEnabled();
  const applied = new Set(apps.map((a) => a.schemeId));
  return (
    <div className="space-y-6">
      <PageHeader title={t("Fees")} description={`${s.firstName} ${s.lastName} · ${s.studentNo}`} />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        <StatCard label="Outstanding" value={fmt(outstanding)} icon={Wallet} tone={overdue.length ? "danger" : outstanding ? "warning" : "success"} hint={overdue.length ? `${overdue.length} invoice(s) overdue` : outstanding ? `Next due ${fmtDate(open.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0]?.dueDate)}` : "Nothing due"} />
        <StatCard label="Paid this year" value={fmt(payments.filter((p) => p.status === "SUCCEEDED" && p.receivedAt.getFullYear() === now.getFullYear()).reduce((a, p) => a + toMinor(p.amount), 0))} />
      </div>
      {outstanding > 0 && !online && <p className="rounded-lg border px-4 py-3 text-sm">Online payment is not available yet. Pay at the accounts office quoting your invoice number; your receipt appears here immediately.</p>}
      <Section title="Invoices" bodyClassName="p-0">
        {invoices.length === 0 ? <p className="px-5 py-4 text-sm text-muted-foreground">No invoices.</p> : (
          <DataTable head={[{ label: "Invoice" }, { label: "Due" }, { label: "Total", className: "text-right" }, { label: "Balance", className: "text-right" }, { label: "Status" }, { label: "" }]}>
            {invoices.map((i) => {
              const bal = toMinor(i.total) - toMinor(i.amountPaid);
              return (
                <tr key={i.id}>
                  <Td><Link href={`/finance/invoices/${i.id}`} className="font-mono text-xs hover:text-primary">{i.number}</Link></Td>
                  <Td className={bal > 0 && i.dueDate < now && !i.cancelledAt ? "text-xs font-medium text-tone-danger" : "text-xs"}>{fmtDate(i.dueDate)}</Td>
                  <Td className="text-right tabular">{fmt(toMinor(i.total))}</Td>
                  <Td className="text-right tabular">{fmt(Math.max(0, bal))}</Td>
                  <Td><StatusBadge meta={INVOICE_STATUS[i.status]} /></Td>
                  <Td className="text-right">{bal > 0 && !i.cancelledAt && <PayOnlineButton invoiceId={i.id} enabled={online} />}</Td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Section>
      {payments.length > 0 && (
        <Section title="Receipts" bodyClassName="p-0">
          <DataTable head={[{ label: "Receipt" }, { label: "Date" }, { label: "Method" }, { label: "Amount", className: "text-right" }, { label: "Status" }]}>
            {payments.map((p) => (
              <tr key={p.id}>
                <Td><Link href={`/portal/fees/receipts/${p.id}`} className="font-mono text-xs hover:text-primary">{p.receiptNo}</Link></Td>
                <Td className="text-xs">{fmtDate(p.receivedAt)}</Td>
                <Td className="text-xs">{PAYMENT_METHOD_LABEL[p.method]}</Td>
                <Td className="text-right tabular">{fmt(toMinor(p.amount))}</Td>
                <Td><StatusBadge meta={PAYMENT_STATUS[p.status]} /></Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
      {(schemes.length > 0 || apps.length > 0) && (
        <Section title="Scholarships" bodyClassName="p-0">
          <ul className="divide-y text-sm">
            {apps.map((a) => <li key={a.id} className="flex items-center gap-3 px-5 py-2.5"><GraduationCap className="size-4 text-muted-foreground" /><span className="flex-1">{a.scheme.name}</span><span className="text-xs text-muted-foreground">{a.status.replace("_", " ").toLowerCase()}{a.awardAmount && ["APPROVED", "DISBURSED"].includes(a.status) ? ` · ${fmt(toMinor(a.awardAmount))}` : ""}</span></li>)}
            {schemes.filter((sc) => !applied.has(sc.id)).map((sc) => (
              <li key={sc.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                <span className="flex-1"><span className="font-medium">{sc.name}</span><span className="block text-xs text-muted-foreground">{sc.amount ? fmt(toMinor(sc.amount)) : `${sc.percent}% of tuition`}{sc.closesAt ? ` · closes ${fmtDate(sc.closesAt)}` : ""}{sc.description ? ` · ${sc.description}` : ""}</span></span>
                <FormDialog
                  title={`Application: ${sc.name}`}
                  description="Eligibility is checked against your record when you submit."
                  fields={[{ name: "declaredIncome", label: "Annual family income", type: "number", optional: true }, { name: "statement", label: "Why are you applying?", type: "textarea" }]}
                  action={applyScholarshipFormAction.bind(null, sc.id)}
                  submitLabel="Apply"
                  trigger={<Button size="xs" variant="outline">Apply</Button>}
                />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
