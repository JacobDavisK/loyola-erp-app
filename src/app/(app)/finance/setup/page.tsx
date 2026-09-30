import Link from "next/link";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { FormDialog, type FormField } from "@/components/app/form-dialog";
import { PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { saveFeeHeadAction } from "@/features/finance/actions";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Fee setup" };

const CATEGORIES = ["TUITION", "ADMISSION", "EXAMINATION", "REVALUATION", "HOSTEL", "TRANSPORT", "LIBRARY", "FINE", "CERTIFICATE", "MISCELLANEOUS"];
const STATUS = { DRAFT: "Draft", ACTIVE: "Active", RETIRED: "Retired" } as const;

export default async function FeeSetupPage() {
  await requirePageAuth("fee.manage");
  const [heads, structures, accounts, inst] = await Promise.all([
    db.feeHead.findMany({ orderBy: { code: "asc" }, include: { incomeAccount: { select: { code: true } } } }),
    db.feeStructure.findMany({ orderBy: [{ code: "asc" }, { version: "desc" }], include: { academicYear: { select: { label: true } }, program: { select: { code: true } }, batch: { select: { code: true } }, lines: true, _count: { select: { invoices: true } } } }),
    db.ledgerAccount.findMany({ where: { type: "INCOME" }, orderBy: { code: "asc" } }),
    db.institution.findFirstOrThrow({ select: { currency: true, locale: true } }),
  ]);
  const fields: FormField[] = [
    { name: "code", label: "Code", type: "text", upper: true },
    { name: "name", label: "Name", type: "text" },
    { name: "category", label: "Category", type: "select", options: CATEGORIES.map((c) => ({ value: c, label: c.charAt(0) + c.slice(1).toLowerCase() })) },
    { name: "incomeAccountId", label: "Income account", type: "select", optional: true, options: accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })), hint: "Defaults to general fee income" },
    { name: "isRefundable", label: "Refundable", type: "checkbox" },
    { name: "isActive", label: "Active", type: "checkbox" },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Fee setup" breadcrumbs={[{ label: "Finance", href: "/finance" }, { label: "Setup" }]} description="Fee heads and versioned fee structures. Invoices record the structure version they came from." />
      <Section title="Fee heads" actions={<FormDialog title="Fee head" fields={fields} columns={2} action={saveFeeHeadAction} initial={{ category: "TUITION", isActive: true }} />} bodyClassName="p-0">
        <DataTable head={[{ label: "Code" }, { label: "Name" }, { label: "Category" }, { label: "Income account" }, { label: "" }]}>
          {heads.map((h) => (
            <tr key={h.id} className={h.isActive ? undefined : "opacity-60"}>
              <Td className="font-mono text-xs">{h.code}</Td>
              <Td>{h.name}{h.isRefundable && <span className="ml-2 text-[11px] text-muted-foreground">refundable</span>}</Td>
              <Td className="text-xs">{h.category.toLowerCase()}</Td>
              <Td className="text-xs">{h.incomeAccount?.code ?? "4100 (default)"}</Td>
              <Td className="text-right"><FormDialog title="Fee head" fields={fields} columns={2} action={saveFeeHeadAction} id={h.id} initial={{ code: h.code, name: h.name, category: h.category, incomeAccountId: h.incomeAccountId, isRefundable: h.isRefundable, isActive: h.isActive }} /></Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      <Section title="Fee structures" actions={<Button asChild size="xs" variant="outline"><Link href="/finance/setup/structures/new"><Plus /> Structure</Link></Button>} bodyClassName="p-0">
        <DataTable head={[{ label: "Structure" }, { label: "Applies to" }, { label: "Annual total", className: "text-right" }, { label: "Invoices", className: "text-right" }, { label: "Status" }]}>
          {structures.map((s) => (
            <tr key={s.id}>
              <Td><Link href={`/finance/setup/structures/${s.id}`} className="font-medium hover:text-primary">{s.name}</Link><div className="font-mono text-[11px] text-muted-foreground">{s.code} v{s.version}</div></Td>
              <Td className="text-xs">{s.academicYear.label} · {s.program?.code ?? "any programme"}{s.batch ? ` · ${s.batch.code}` : ""}</Td>
              <Td className="text-right text-xs tabular">{formatMoney(s.lines.reduce((a, l) => a + toMinor(l.amount) * (l.termType ? 1 : 2), 0), inst.currency, inst.locale)}</Td>
              <Td className="text-right tabular">{s._count.invoices}</Td>
              <Td className="text-xs">{STATUS[s.status]}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
