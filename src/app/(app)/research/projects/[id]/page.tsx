import { notFound } from "next/navigation";
import { Pencil, Send } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ActionButton } from "@/features/academic-ops/controls";
import { recordExpenseAction, recordSanctionAction, saveProjectAction, submitProjectAction } from "@/features/quality/actions";
import { CompleteProjectButton } from "@/features/quality/controls";
import { EXPENSE_FIELDS, HEAD_LABEL, PROJECT_FIELDS, PROJECT_STATUS, SANCTION_FIELDS } from "@/features/quality/fields";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { fmtDate } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { loadProjectFor } from "@/server/services/research";

export const metadata: Metadata = { title: "Research project" };

const ROLE = { PI: "Principal investigator", CO_PI: "Co-investigator", MEMBER: "Team member" } as const;

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth();
  const r = await loadProjectFor(ctx, id).catch(() => null);
  if (!r) notFound();
  const { project: p, isPi, manage, utilisation: u } = r;
  const inst = await db.institution.findFirstOrThrow({ select: { currency: true, locale: true } });
  const fmt = (m: number) => formatMoney(m, inst.currency, inst.locale);
  const workflow = await db.workflowInstance.findFirst({ where: { resourceType: "researchProject", resourceId: id }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const empNo = async (ids: string[]) => (await db.employee.findMany({ where: { id: { in: ids } }, select: { employeeNo: true } })).map((e) => e.employeeNo).join(", ");
  const budgetInit = Object.fromEntries(p.budget.map((b) => [`budget_${b.head}`, Number(b.amount)]));
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={p.code}
        title={p.title}
        breadcrumbs={[{ label: isPi || r.isMember ? "My research" : "Research", href: isPi || r.isMember ? "/me/research" : "/research" }, { label: p.code }]}
        description={<span className="flex flex-wrap items-center gap-2"><StatusBadge meta={PROJECT_STATUS[p.status]} /> {p.fundingAgency}{p.scheme ? ` · ${p.scheme}` : ""} · {p.department?.name ?? "—"}{workflow ? <a className="text-primary hover:underline" href={`/inbox/requests/${workflow.id}`}>clearance record</a> : null}</span>}
        actions={
          <div className="flex flex-wrap gap-2">
            {isPi && p.status === "DRAFT" && (
              <>
                <FormDialog title="Proposal" columns={2} id={p.id} fields={PROJECT_FIELDS} action={saveProjectAction} trigger={<Button size="sm" variant="outline"><Pencil /> Edit</Button>}
                  initial={{ title: p.title, abstract: p.abstract, fundingAgency: p.fundingAgency, scheme: p.scheme, durationMonths: p.durationMonths, coPis: await empNo(p.members.filter((m) => m.role === "CO_PI").map((m) => m.employeeId)), team: await empNo(p.members.filter((m) => m.role === "MEMBER").map((m) => m.employeeId)), ...budgetInit }} />
                <ActionButton label="Submit for clearance" variant="default" icon={<Send />} run={submitProjectAction.bind(null, p.id)} confirmText="Send this proposal to your head of department and the Dean of Research for institutional clearance?" />
              </>
            )}
            {manage && p.status === "APPROVED" && <FormDialog title="Sanction" columns={2} id={p.id} fields={SANCTION_FIELDS} action={recordSanctionAction} initial={budgetInit} submitLabel="Record sanction" trigger={<Button size="sm">Record sanction</Button>} />}
            {(isPi || manage) && p.status === "SANCTIONED" && (
              <>
                <FormDialog title="Expense" columns={2} id={p.id} fields={EXPENSE_FIELDS} action={recordExpenseAction} initial={{ head: u.heads[0]?.head ?? "EQUIPMENT", date: new Date().toISOString().slice(0, 10) }} submitLabel="Record" trigger={<Button size="sm" variant="outline">Record expense</Button>} />
                <CompleteProjectButton id={p.id} />
              </>
            )}
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Section title="Abstract"><p className="whitespace-pre-wrap text-sm">{p.abstract}</p>{p.outcome && <><h3 className="mt-4 text-sm font-medium">Outcomes</h3><p className="whitespace-pre-wrap text-sm">{p.outcome}</p></>}</Section>
        <Section title="Details">
          <KeyValue items={[
            ["Proposed", fmt(toMinor(p.proposedAmount))],
            ["Sanctioned", p.sanctionedAmount ? fmt(toMinor(p.sanctionedAmount)) : "—"],
            ["Grant reference", p.grantRef ?? "—"],
            ["Duration", `${p.durationMonths} months`],
            ["Period", p.startDate ? `${fmtDate(p.startDate)} – ${fmtDate(p.endDate)}` : "—"],
          ]} />
          <h3 className="mb-1.5 mt-4 text-sm font-medium">Team</h3>
          <ul className="space-y-1 text-sm">{p.members.map((m) => <li key={m.employeeId}>{m.employee.firstName} {m.employee.lastName} <span className="text-xs text-muted-foreground">{ROLE[m.role]}</span></li>)}</ul>
        </Section>
      </div>
      <Section title="Budget" description={p.status === "SANCTIONED" || p.status === "COMPLETED" ? `${fmt(u.spent)} spent of ${fmt(u.sanctioned)}` : "Proposed budget"} bodyClassName="p-0">
        <DataTable head={[{ label: "Head" }, { label: "Budget", className: "text-right" }, { label: "Spent", className: "text-right" }, { label: "Remaining", className: "text-right" }, { label: "Utilisation" }]} empty="No budget lines.">
          {u.heads.map((h) => (
            <tr key={h.head}>
              <Td>{HEAD_LABEL[h.head]}</Td>
              <Td className="text-right tabular">{fmt(h.sanctioned)}</Td>
              <Td className="text-right tabular">{fmt(h.spent)}</Td>
              <Td className="text-right tabular">{fmt(h.remaining)}</Td>
              <Td className="w-48"><div className="flex items-center gap-2"><Progress value={Math.min(100, h.percent)} aria-label={`${HEAD_LABEL[h.head]} utilisation`} /><span className="w-12 text-xs tabular">{h.percent}%</span></div></Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      {p.expenses.length > 0 && (
        <Section title="Spending" description="Append-only; corrections are negative entries." bodyClassName="p-0">
          <DataTable head={[{ label: "Date" }, { label: "Head" }, { label: "Description" }, { label: "Voucher" }, { label: "Amount", className: "text-right" }]}>
            {p.expenses.map((e) => (
              <tr key={e.id}>
                <Td className="text-xs whitespace-nowrap">{fmtDate(e.date)}</Td>
                <Td className="text-xs">{HEAD_LABEL[e.head]}</Td>
                <Td className="text-sm">{e.description}</Td>
                <Td className="font-mono text-xs">{e.voucherNo ?? "—"}</Td>
                <Td className="text-right tabular">{fmt(toMinor(e.amount))}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
      {p.publications.length > 0 && <Section title="Publications from this project"><ul className="space-y-1 text-sm">{p.publications.map((x) => <li key={x.id}>{x.title} <span className="text-xs text-muted-foreground">({x.year})</span></li>)}</ul></Section>}
    </div>
  );
}
