import Link from "next/link";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { FormDialog, type FormField } from "@/components/app/form-dialog";
import { PageHeader, Section } from "@/components/app/page";
import { DisburseButton } from "@/features/finance/controls";
import { saveSchemeFormAction } from "@/features/finance/actions";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { criteriaSchema } from "@/lib/domain/scholarship";
import { fmtDate } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Scholarships" };

const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);

export default async function ScholarshipsPage() {
  await requirePageAuth("scholarship.manage");
  const [schemes, apps, inst] = await Promise.all([
    db.scholarshipScheme.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { applications: true } } } }),
    db.scholarshipApplication.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { scheme: { select: { code: true, name: true } }, student: { select: { id: true, studentNo: true, firstName: true, lastName: true } } } }),
    db.institution.findFirstOrThrow({ select: { currency: true, locale: true } }),
  ]);
  const fmt = (m: number) => formatMoney(m, inst.currency, inst.locale);
  const fields: FormField[] = [
    { name: "code", label: "Code", type: "text", upper: true },
    { name: "name", label: "Name", type: "text" },
    { name: "sponsor", label: "Sponsor", type: "text", optional: true },
    { name: "status", label: "Status", type: "select", options: [{ value: "DRAFT", label: "Draft" }, { value: "OPEN", label: "Open for applications" }, { value: "CLOSED", label: "Closed" }] },
    { name: "amount", label: "Fixed award", type: "number", optional: true, hint: "Either a fixed amount…" },
    { name: "percent", label: "Or % of tuition", type: "number", optional: true, min: 1, max: 100 },
    { name: "seats", label: "Seats", type: "number", optional: true },
    { name: "opensAt", label: "Opens", type: "date", optional: true },
    { name: "closesAt", label: "Closes", type: "date", optional: true },
    { name: "minCgpa", label: "Minimum CGPA", type: "number", optional: true, step: 0.1 },
    { name: "minAttendancePercent", label: "Minimum attendance %", type: "number", optional: true },
    { name: "maxFamilyIncome", label: "Maximum family income", type: "number", optional: true },
    { name: "programCodes", label: "Programmes (codes, comma-separated)", type: "text", optional: true },
    { name: "categories", label: "Admission categories (comma-separated)", type: "text", optional: true },
    { name: "noFailures", label: "No outstanding failures", type: "checkbox", wide: true },
    { name: "description", label: "Description", type: "textarea", optional: true },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Scholarships" breadcrumbs={[{ label: "Finance", href: "/finance" }, { label: "Scholarships" }]} description="Schemes with rule-based eligibility. Students apply from the portal; the department recommends and the scholarship desk decides; awards are credited against fees." />
      <Section title="Schemes" actions={<FormDialog title="Scholarship scheme" fields={fields} columns={2} action={saveSchemeFormAction} initial={{ status: "DRAFT" }} />} bodyClassName="p-0">
        <DataTable head={[{ label: "Scheme" }, { label: "Award" }, { label: "Eligibility" }, { label: "Window" }, { label: "Applications", className: "text-right" }, { label: "Status" }, { label: "" }]}>
          {schemes.map((s) => {
            const c = criteriaSchema.catch({}).parse(s.criteria);
            return (
              <tr key={s.id}>
                <Td><div className="font-medium">{s.name}</div><div className="text-[11px] text-muted-foreground">{s.code}{s.sponsor ? ` · ${s.sponsor}` : ""}</div></Td>
                <Td className="text-xs">{s.amount ? fmt(toMinor(s.amount)) : `${s.percent}% of tuition`}{s.seats ? ` · ${s.seats} seats` : ""}</Td>
                <Td className="text-xs">{[c.minCgpa != null && `CGPA ≥ ${c.minCgpa}`, c.minAttendancePercent != null && `attendance ≥ ${c.minAttendancePercent}%`, c.maxFamilyIncome != null && `income ≤ ${c.maxFamilyIncome}`, c.programCodes?.length && c.programCodes.join("/"), c.noFailures && "no failures"].filter(Boolean).join(" · ") || "Open to all"}</Td>
                <Td className="text-xs whitespace-nowrap">{s.opensAt ? fmtDate(s.opensAt) : "—"} – {s.closesAt ? fmtDate(s.closesAt) : "—"}</Td>
                <Td className="text-right tabular">{s._count.applications}</Td>
                <Td className="text-xs">{s.status.toLowerCase()}</Td>
                <Td className="text-right">
                  <FormDialog title="Scholarship scheme" fields={fields} columns={2} action={saveSchemeFormAction} id={s.id}
                    initial={{ code: s.code, name: s.name, sponsor: s.sponsor, status: s.status, amount: s.amount ? Number(s.amount) : null, percent: s.percent, seats: s.seats, opensAt: d(s.opensAt), closesAt: d(s.closesAt), minCgpa: c.minCgpa ?? null, minAttendancePercent: c.minAttendancePercent ?? null, maxFamilyIncome: c.maxFamilyIncome ?? null, programCodes: c.programCodes?.join(", ") ?? "", categories: c.categories?.join(", ") ?? "", noFailures: !!c.noFailures, description: s.description }} />
                </Td>
              </tr>
            );
          })}
        </DataTable>
      </Section>
      <Section title="Applications" bodyClassName="p-0">
        {apps.length === 0 ? <p className="px-5 py-4 text-sm text-muted-foreground">No applications yet.</p> : (
          <DataTable head={[{ label: "Student" }, { label: "Scheme" }, { label: "Award", className: "text-right" }, { label: "Status" }, { label: "Applied" }, { label: "" }]}>
            {apps.map((a) => (
              <tr key={a.id}>
                <Td><Link href={`/students/${a.student.id}?tab=fees`} className="hover:text-primary">{a.student.firstName} {a.student.lastName}</Link><div className="font-mono text-[11px] text-muted-foreground">{a.student.studentNo}</div></Td>
                <Td className="text-xs">{a.scheme.name}</Td>
                <Td className="text-right tabular">{a.awardAmount ? fmt(toMinor(a.awardAmount)) : "—"}</Td>
                <Td className="text-xs">{a.status.replace("_", " ").toLowerCase()}</Td>
                <Td className="text-xs">{fmtDate(a.createdAt)}</Td>
                <Td className="text-right">{a.status === "APPROVED" && <DisburseButton id={a.id} />}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
    </div>
  );
}
