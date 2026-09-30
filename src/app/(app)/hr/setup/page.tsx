import Link from "next/link";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog, type FormField } from "@/components/app/form-dialog";
import { DataTable, LinkTabs, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { createAppraisalCycleAction, saveComponentAction, saveLeaveTypeAction, savePositionAction } from "@/features/hr/actions";
import { ActivateSalaryStructureButton, HrSettingsForm } from "@/features/hr/controls";
import { fmtDate } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { getSetting } from "@/server/services/settings";

export const metadata: Metadata = { title: "HR setup" };

const STATUS = { DRAFT: "Draft", ACTIVE: "Active", RETIRED: "Retired" } as const;
const KIND = { EARNING: "Earning", DEDUCTION: "Deduction", EMPLOYER_CONTRIBUTION: "Employer contribution" } as const;

export default async function HrSetupPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePageAuth(["hr.manage", "payroll.process", "appraisal.manage"]);
  const { tab = can(ctx, "hr.manage") ? "leave" : "payroll" } = await searchParams;
  const tabs = [
    ...(can(ctx, "hr.manage") ? [{ key: "leave", label: "Leave types", href: "?tab=leave" }, { key: "positions", label: "Positions", href: "?tab=positions" }] : []),
    ...(can(ctx, "payroll.process") ? [{ key: "payroll", label: "Salary", href: "?tab=payroll" }] : []),
    ...(can(ctx, "appraisal.manage") ? [{ key: "appraisal", label: "Appraisal", href: "?tab=appraisal" }] : []),
    { key: "settings", label: "Settings", href: "?tab=settings" },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="HR setup" breadcrumbs={[{ label: "People" }, { label: "HR setup" }]} description="Leave policy, sanctioned positions, salary components and structures, appraisal cycles and payroll settings." />
      <LinkTabs tabs={tabs} active={tab} />
      {tab === "leave" && can(ctx, "hr.manage") && <LeaveTypes />}
      {tab === "positions" && can(ctx, "hr.manage") && <Positions />}
      {tab === "payroll" && can(ctx, "payroll.process") && <Salary />}
      {tab === "appraisal" && can(ctx, "appraisal.manage") && <Appraisal />}
      {tab === "settings" && <Section title="HR & payroll settings"><HrSettingsForm initial={await getSetting("hr")} readOnly={!can(ctx, "hr.manage") && !can(ctx, "payroll.process")} /></Section>}
    </div>
  );
}

const LEAVE_FIELDS: FormField[] = [
  { name: "code", label: "Code", type: "text", upper: true },
  { name: "name", label: "Name", type: "text" },
  { name: "annualQuota", label: "Days a year", type: "number", min: 0, step: 0.5 },
  { name: "carryForwardMax", label: "Carry forward up to", type: "number", min: 0, step: 0.5 },
  { name: "maxConsecutive", label: "Most days at a time", type: "number", optional: true, min: 1 },
  { name: "appliesTo", label: "Applies to", type: "select", optional: true, options: [{ value: "TEACHING", label: "Teaching staff only" }, { value: "NON_TEACHING", label: "Non-teaching staff only" }] },
  { name: "paid", label: "Paid leave (unpaid leave is loss of pay)", type: "checkbox", wide: true },
  { name: "allowHalfDay", label: "Can be taken as half days", type: "checkbox", wide: true },
  { name: "requiresDocument", label: "Supporting document expected", type: "checkbox", wide: true },
  { name: "isActive", label: "Active", type: "checkbox", wide: true },
];

async function LeaveTypes() {
  const types = await db.leaveType.findMany({ orderBy: { code: "asc" }, include: { _count: { select: { requests: true } } } });
  return (
    <Section title="Leave types" actions={<FormDialog title="Leave type" columns={2} fields={LEAVE_FIELDS} action={saveLeaveTypeAction} initial={{ paid: true, allowHalfDay: true, isActive: true, carryForwardMax: 0 }} />} bodyClassName="p-0">
      <DataTable head={[{ label: "Code" }, { label: "Name" }, { label: "Days a year", className: "text-right" }, { label: "Carry forward", className: "text-right" }, { label: "Rules" }, { label: "Applications", className: "text-right" }, { label: "" }]}>
        {types.map((t) => (
          <tr key={t.id} className={t.isActive ? undefined : "opacity-60"}>
            <Td className="font-mono text-xs">{t.code}</Td>
            <Td>{t.name}</Td>
            <Td className="text-right tabular">{t.annualQuota}</Td>
            <Td className="text-right tabular">{t.carryForwardMax || "—"}</Td>
            <Td className="text-xs">{[t.paid ? "paid" : "unpaid", t.allowHalfDay && "half days", t.maxConsecutive && `max ${t.maxConsecutive} at a time`, t.requiresDocument && "document", t.appliesTo && (t.appliesTo === "TEACHING" ? "teaching only" : "non-teaching only")].filter(Boolean).join(" · ")}</Td>
            <Td className="text-right tabular">{t._count.requests}</Td>
            <Td className="text-right"><FormDialog title="Leave type" columns={2} fields={LEAVE_FIELDS} action={saveLeaveTypeAction} id={t.id} initial={{ code: t.code, name: t.name, annualQuota: t.annualQuota, carryForwardMax: t.carryForwardMax, maxConsecutive: t.maxConsecutive, appliesTo: t.appliesTo, paid: t.paid, allowHalfDay: t.allowHalfDay, requiresDocument: t.requiresDocument, isActive: t.isActive }} /></Td>
          </tr>
        ))}
      </DataTable>
    </Section>
  );
}

async function Positions() {
  const [positions, departments] = await Promise.all([
    db.position.findMany({ orderBy: { code: "asc" }, include: { department: { select: { code: true } }, _count: { select: { employees: { where: { deletedAt: null, status: { in: ["ACTIVE", "ON_LEAVE", "SUSPENDED"] } } } } } } }),
    db.department.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const fields: FormField[] = [
    { name: "code", label: "Code", type: "text", upper: true },
    { name: "title", label: "Title", type: "text" },
    { name: "category", label: "Category", type: "select", options: [{ value: "TEACHING", label: "Teaching" }, { value: "NON_TEACHING", label: "Non-teaching" }] },
    { name: "departmentId", label: "Department", type: "select", optional: true, options: departments.map((d) => ({ value: d.id, label: d.name })) },
    { name: "grade", label: "Pay level / grade", type: "text", optional: true },
    { name: "sanctioned", label: "Sanctioned posts", type: "number", min: 0 },
  ];
  return (
    <Section title="Sanctioned positions" description="Filled against sanctioned strength." actions={<FormDialog title="Position" columns={2} fields={fields} action={savePositionAction} initial={{ category: "TEACHING", sanctioned: 1 }} />} bodyClassName="p-0">
      <DataTable head={[{ label: "Code" }, { label: "Title" }, { label: "Department" }, { label: "Grade" }, { label: "Filled / sanctioned", className: "text-right" }, { label: "" }]}>
        {positions.map((p) => (
          <tr key={p.id}>
            <Td className="font-mono text-xs">{p.code}</Td>
            <Td>{p.title}</Td>
            <Td className="text-xs">{p.department?.code ?? "—"}</Td>
            <Td className="text-xs">{p.grade ?? "—"}</Td>
            <Td className={p._count.employees > p.sanctioned ? "text-right font-medium text-tone-danger tabular" : "text-right tabular"}>{p._count.employees} / {p.sanctioned}</Td>
            <Td className="text-right"><FormDialog title="Position" columns={2} fields={fields} action={savePositionAction} id={p.id} initial={{ code: p.code, title: p.title, category: p.category, departmentId: p.departmentId, grade: p.grade, sanctioned: p.sanctioned }} /></Td>
          </tr>
        ))}
      </DataTable>
    </Section>
  );
}

async function Salary() {
  const [components, structures, accounts] = await Promise.all([
    db.salaryComponent.findMany({ orderBy: [{ kind: "asc" }, { code: "asc" }], include: { account: { select: { code: true } } } }),
    db.salaryStructure.findMany({ orderBy: [{ code: "asc" }, { version: "desc" }], include: { _count: { select: { lines: true, salaries: true } } } }),
    db.ledgerAccount.findMany({ where: { type: { in: ["EXPENSE", "LIABILITY"] } }, orderBy: { code: "asc" } }),
  ]);
  const fields: FormField[] = [
    { name: "code", label: "Code", type: "text", upper: true },
    { name: "name", label: "Name", type: "text" },
    { name: "kind", label: "Kind", type: "select", options: Object.entries(KIND).map(([value, label]) => ({ value, label })) },
    { name: "accountId", label: "Ledger account", type: "select", optional: true, options: accounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` })), hint: "Defaults: earnings 5200, deductions 2310 (tax 2320), employer contributions 5210." },
    { name: "taxable", label: "Taxable earning", type: "checkbox" },
    { name: "isActive", label: "Active", type: "checkbox" },
  ];
  const activeCodes = new Set(structures.filter((s) => s.status === "ACTIVE").map((s) => s.code));
  return (
    <div className="space-y-6">
      <Section title="Salary components" actions={<FormDialog title="Salary component" columns={2} fields={fields} action={saveComponentAction} initial={{ kind: "EARNING", taxable: true, isActive: true }} />} bodyClassName="p-0">
        <DataTable head={[{ label: "Code" }, { label: "Name" }, { label: "Kind" }, { label: "Account" }, { label: "Taxable" }, { label: "" }]}>
          {components.map((c) => (
            <tr key={c.id} className={c.isActive ? undefined : "opacity-60"}>
              <Td className="font-mono text-xs">{c.code}</Td>
              <Td>{c.name}</Td>
              <Td className="text-xs">{KIND[c.kind]}</Td>
              <Td className="text-xs">{c.account?.code ?? "default"}</Td>
              <Td className="text-xs">{c.kind === "EARNING" ? (c.taxable ? "yes" : "no") : "—"}</Td>
              <Td className="text-right"><FormDialog title="Salary component" columns={2} fields={fields} action={saveComponentAction} id={c.id} initial={{ code: c.code, name: c.name, kind: c.kind, accountId: c.accountId, taxable: c.taxable, isActive: c.isActive }} /></Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      <Section title="Salary structures" description="Versioned. Editing an active structure creates a new draft version; activating it can move employees across from a date." actions={<Button asChild size="xs" variant="outline"><Link href="/hr/setup/structures/new"><Plus /> Structure</Link></Button>} bodyClassName="p-0">
        <DataTable head={[{ label: "Structure" }, { label: "Version" }, { label: "Components", className: "text-right" }, { label: "Employees (pay rows)", className: "text-right" }, { label: "Status" }, { label: "" }]}>
          {structures.map((s) => (
            <tr key={s.id}>
              <Td><Link className="hover:text-primary" href={`/hr/setup/structures/${s.id}`}>{s.name}</Link><div className="font-mono text-[11px] text-muted-foreground">{s.code}</div></Td>
              <Td className="tabular">v{s.version}</Td>
              <Td className="text-right tabular">{s._count.lines}</Td>
              <Td className="text-right tabular">{s._count.salaries}</Td>
              <Td className="text-xs">{STATUS[s.status]}</Td>
              <Td className="text-right">{s.status === "DRAFT" && <ActivateSalaryStructureButton id={s.id} hasPrevious={activeCodes.has(s.code)} />}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}

async function Appraisal() {
  const cycles = await db.appraisalCycle.findMany({ orderBy: { opensAt: "desc" }, include: { appraisals: { select: { status: true } } } });
  const fields: FormField[] = [
    { name: "name", label: "Name", type: "text", wide: true },
    { name: "year", label: "Year", type: "number" },
    { name: "opensAt", label: "Opens", type: "date" },
    { name: "closesAt", label: "Closes", type: "date" },
    { name: "criteria", label: "Criteria (one per line: key | label | weight)", type: "textarea", wide: true, placeholder: "teaching | Teaching and learning | 40\nresearch | Research and publications | 30\nservice | Institutional service | 30" },
  ];
  return (
    <Section title="Appraisal cycles" actions={<FormDialog title="Appraisal cycle" columns={2} fields={fields} action={createAppraisalCycleFormAction} initial={{ year: new Date().getFullYear(), criteria: "teaching | Teaching and learning | 40\nresearch | Research and publications | 30\nservice | Institutional service | 30" }} submitLabel="Open cycle" />} bodyClassName="p-0">
      <DataTable head={[{ label: "Cycle" }, { label: "Window" }, { label: "Self-review pending", className: "text-right" }, { label: "With reviewer", className: "text-right" }, { label: "Completed", className: "text-right" }]} empty="No appraisal cycles yet.">
        {cycles.map((c) => {
          const n = (s: string) => c.appraisals.filter((a) => a.status === s).length;
          return (
            <tr key={c.id}>
              <Td>{c.name}</Td>
              <Td className="text-xs">{fmtDate(c.opensAt)} – {fmtDate(c.closesAt)}</Td>
              <Td className="text-right tabular">{n("SELF_REVIEW")}</Td>
              <Td className="text-right tabular">{n("MANAGER_REVIEW")}</Td>
              <Td className="text-right tabular">{n("COMPLETED")}</Td>
            </tr>
          );
        })}
      </DataTable>
    </Section>
  );
}

/** Parses the "key | label | weight" lines of the cycle form before calling the action. */
async function createAppraisalCycleFormAction(id: string | null, input: Record<string, unknown>) {
  "use server";
  const criteria = String(input.criteria ?? "").split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p.length === 3 && p[0]).map(([key, label, weight]) => ({ key, label, weight: Number(weight) }));
  return createAppraisalCycleAction(id, { ...input, criteria });
}
