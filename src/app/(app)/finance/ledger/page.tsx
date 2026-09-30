import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { FormDialog, type FormField } from "@/components/app/form-dialog";
import { PageHeader, Section } from "@/components/app/page";
import { saveAccountAction } from "@/features/finance/actions";
import { JournalForm } from "@/features/finance/journal-form";
import { formatMoney } from "@/lib/domain/money";
import { fmtDate } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { trialBalance } from "@/server/services/ledger";

export const metadata: Metadata = { title: "Ledger" };

export default async function LedgerPage() {
  await requirePageAuth("ledger.manage");
  const [tb, entries, inst] = await Promise.all([
    trialBalance(),
    db.journalEntry.findMany({ orderBy: [{ createdAt: "desc" }], take: 30, include: { lines: { include: { account: { select: { code: true } } } } } }),
    db.institution.findFirstOrThrow({ select: { currency: true, locale: true } }),
  ]);
  const fmt = (m: number) => formatMoney(m, inst.currency, inst.locale);
  const dr = tb.reduce((a, x) => a + x.debit, 0);
  const cr = tb.reduce((a, x) => a + x.credit, 0);
  const fields: FormField[] = [
    { name: "code", label: "Code", type: "text", upper: true },
    { name: "name", label: "Name", type: "text" },
    { name: "type", label: "Type", type: "select", options: ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"].map((t) => ({ value: t, label: t.charAt(0) + t.slice(1).toLowerCase() })) },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="General ledger" breadcrumbs={[{ label: "Finance", href: "/finance" }, { label: "Ledger" }]} description="Double-entry ledger fed automatically by invoices, receipts, concessions and refunds. Entries are append-only; corrections are reversing entries. Exportable to an external accounting system." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Section title="Trial balance" description={dr === cr ? "Balanced" : "Out of balance — investigate"} actions={<FormDialog title="Account" fields={fields} action={saveAccountAction} initial={{ type: "EXPENSE" }} />} bodyClassName="p-0">
          <DataTable head={[{ label: "Account" }, { label: "Debit", className: "text-right" }, { label: "Credit", className: "text-right" }, { label: "Balance", className: "text-right" }]}>
            {tb.map((a) => (
              <tr key={a.id}>
                <Td><span className="font-mono text-xs text-muted-foreground">{a.code}</span> {a.name}<div className="text-[11px] text-muted-foreground">{a.type.toLowerCase()}</div></Td>
                <Td className="text-right text-xs tabular">{a.debit ? fmt(a.debit) : ""}</Td>
                <Td className="text-right text-xs tabular">{a.credit ? fmt(a.credit) : ""}</Td>
                <Td className="text-right text-xs font-medium tabular">{fmt(Math.abs(a.balance))} {a.balance >= 0 ? "Dr" : "Cr"}</Td>
              </tr>
            ))}
            <tr className="font-semibold"><Td>Total</Td><Td className="text-right text-xs tabular">{fmt(dr)}</Td><Td className="text-right text-xs tabular">{fmt(cr)}</Td><Td /></tr>
          </DataTable>
        </Section>
        <Section title="Manual journal entry">
          <JournalForm accounts={tb.filter((a) => a.isActive).map((a) => ({ id: a.id, label: `${a.code} ${a.name}` }))} />
        </Section>
      </div>
      <Section title="Recent entries" bodyClassName="p-0">
        <DataTable head={[{ label: "Entry" }, { label: "Date" }, { label: "Narration" }, { label: "Lines" }]}>
          {entries.map((e) => (
            <tr key={e.id}>
              <Td className="font-mono text-xs">{e.number}</Td>
              <Td className="text-xs whitespace-nowrap">{fmtDate(e.date)}</Td>
              <Td className="text-xs">{e.memo}{e.sourceType && <span className="text-muted-foreground"> · {e.sourceType}</span>}</Td>
              <Td className="text-xs">{e.lines.map((l) => `${l.account.code} ${Number(l.debit) ? `Dr ${Number(l.debit).toFixed(2)}` : `Cr ${Number(l.credit).toFixed(2)}`}`).join(" · ")}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
