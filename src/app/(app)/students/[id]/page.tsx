import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckCircle2, CircleAlert, Pencil, UserPlus } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, LinkTabs, Td } from "@/components/app/list";
import { FormDialog, type FormField } from "@/components/app/form-dialog";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { saveGuardianAction } from "@/features/students/actions";
import { ProvisionAccountButton, RemoveGuardianButton, StatusChangeDialog } from "@/features/students/record-controls";
import { STANDING_LABEL } from "@/lib/domain/attendance";
import { INVOICE_STATUS, PAYMENT_STATUS, COURSE_RESULT_STATUS, CREDENTIAL_STATUS, GUARDIAN_RELATION_LABEL, REGISTRATION_STATUS, STUDENT_STATUS, WORKFLOW_STATUS } from "@/lib/domain/labels";
import { IssueCredentialButton } from "@/features/results/credential-controls";
import { RecordPaymentDialog } from "@/features/finance/controls";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { studentResults } from "@/server/services/results";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { loadStudentFor } from "@/server/auth/access";
import { can, isSuperAdmin, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { currentTerm } from "@/server/services/academic-setup";
import { studentAttendance } from "@/server/services/attendance";
import { degreeProgress } from "@/server/services/curriculum";

import { StudentDocumentsTab } from "@/features/campus/student-documents-tab";
import { NepPanel } from "@/features/compliance/nep-panel";
import { SupportPanel } from "@/features/success/support-panel";

export const metadata: Metadata = { title: "Student" };

const GUARDIAN_FIELDS: FormField[] = [
  { name: "name", label: "Name", type: "text", wide: true },
  { name: "relation", label: "Relationship", type: "select", options: Object.entries(GUARDIAN_RELATION_LABEL).map(([value, label]) => ({ value, label })) },
  { name: "occupation", label: "Occupation", type: "text", optional: true },
  { name: "phone", label: "Phone", type: "text", optional: true },
  { name: "email", label: "E-mail", type: "email", optional: true },
  { name: "isPrimary", label: "Primary contact", type: "checkbox" },
  { name: "canViewAcademic", label: "May see attendance and results", type: "checkbox" },
  { name: "canViewFinance", label: "May see fees and payments", type: "checkbox" },
];

type Addr = { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; country?: string } | null;
type Emergency = { name?: string; relation?: string; phone?: string } | null;

export default async function StudentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab = "overview" } = await searchParams;
  const ctx = await requirePageAuth("student.view");
  if (ctx.user.userType !== "STAFF") redirect("/portal");
  const base = await loadStudentFor(ctx, id).catch(() => null);
  if (!base) notFound();
  const s = await db.student.findUniqueOrThrow({
    where: { id },
    include: { program: true, batch: true, department: true, campus: true, user: { select: { id: true, status: true, lastLoginAt: true } }, guardians: { include: { user: { select: { id: true, lastLoginAt: true } } }, orderBy: [{ isPrimary: "desc" }, { name: "asc" }] } },
  });
  const staff = ctx.user.userType === "STAFF";
  const canUpdate = can(ctx, "student.update", s.departmentId);
  const canStatus = can(ctx, "student.status", s.departmentId);
  const term = await currentTerm();

  const addr = s.address as Addr;
  const em = s.emergencyContact as Emergency;
  const tabs = [
    { key: "overview", label: "Overview", href: `/students/${id}` },
    { key: "guardians", label: "Guardians", count: s.guardians.length, href: `/students/${id}?tab=guardians` },
    { key: "academics", label: "Courses & attendance", href: `/students/${id}?tab=academics` },
    { key: "progress", label: "Degree progress", href: `/students/${id}?tab=progress` },
    { key: "nep", label: "ABC & NEP", href: `/students/${id}?tab=nep` },
    { key: "support", label: "Mentoring & support", href: `/students/${id}?tab=support` },
    ...(can(ctx, "result.view", s.departmentId) ? [{ key: "results", label: "Results", href: `/students/${id}?tab=results` }] : []),
    ...(can(ctx, "finance.view", s.departmentId) ? [{ key: "fees", label: "Fees", href: `/students/${id}?tab=fees` }] : []),
    { key: "credentials", label: "Certificates", href: `/students/${id}?tab=credentials` },
    { key: "documents", label: "Documents", href: `/students/${id}?tab=documents` },
    ...(staff ? [{ key: "history", label: "History", href: `/students/${id}?tab=history` }] : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={staff ? [{ label: "Students", href: "/students" }, { label: s.studentNo }] : undefined}
        eyebrow={<span className="font-mono">{s.studentNo}</span>}
        title={<span className="flex flex-wrap items-center gap-3">{s.firstName} {s.lastName} <StatusBadge meta={STUDENT_STATUS[s.status]} size="md" /></span>}
        description={`${s.program.name} · ${s.batch.code} · Semester ${s.currentSemester}${s.section ? ` · Section ${s.section}` : ""}`}
        actions={
          staff ? (
            <>
              {canUpdate && <Button asChild size="sm" variant="outline"><Link href={`/students/${id}/edit`}><Pencil /> Edit</Link></Button>}
              {isSuperAdmin(ctx) && <Button asChild size="sm" variant="outline"><Link href={`/portal?student=${id}`}>View portal</Link></Button>}
              {canStatus && <StatusChangeDialog studentId={id} current={s.status} />}
              {canUpdate && !s.userId && <ProvisionAccountButton studentId={id} label="Create portal account" />}
            </>
          ) : null
        }
      />
      <LinkTabs tabs={tabs} active={tab} />

      {tab === "overview" && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Section title="Identity">
            <KeyValue
              items={[
                ["Student number", <span key="n" className="font-mono">{s.studentNo}</span>],
                ["Admission number", <span key="a" className="font-mono">{s.admissionNo}</span>],
                ["Registration number", s.registrationNo ? <span key="r" className="font-mono">{s.registrationNo}</span> : "Not yet issued"],
                ["Date of birth", fmtDate(s.dateOfBirth)],
                ["Gender", s.gender ? s.gender.charAt(0) + s.gender.slice(1).toLowerCase() : "—"],
                ["Nationality", s.nationality ?? "—"],
                ...(staff ? ([["Admission category", s.category ?? "—"], ["Blood group", s.bloodGroup ?? "—"]] as [string, string][]) : []),
              ]}
            />
          </Section>
          <Section title="Programme">
            <KeyValue
              items={[
                ["Programme", `${s.program.code} — ${s.program.name}`],
                ["Batch", s.batch.name],
                ["Department", s.department.name],
                ["Campus", s.campus?.name ?? "—"],
                ["Semester", s.currentSemester],
                ["Specialisation", s.specialization ?? "—"],
                ["Admitted", fmtDate(s.admittedOn)],
                ...(s.graduatedOn ? ([["Graduated", fmtDate(s.graduatedOn)]] as [string, string][]) : []),
                ["Portal account", s.user ? `${s.user.status === "ACTIVE" ? "Active" : "Disabled"} · last sign-in ${fmtDateTime(s.user.lastLoginAt)}` : "Not created"],
              ]}
            />
          </Section>
          <Section title="Contact">
            <KeyValue
              items={[
                ["E-mail", s.email],
                ["Phone", s.phone ?? "—"],
                ["Address", addr && Object.values(addr).some(Boolean) ? [addr.line1, addr.line2, [addr.city, addr.state, addr.postalCode].filter(Boolean).join(" "), addr.country].filter(Boolean).join(", ") : "—"],
              ]}
            />
          </Section>
          <Section title="Emergency contact">
            <KeyValue items={[["Name", em?.name ?? "—"], ["Relationship", em?.relation ?? "—"], ["Phone", em?.phone ?? "—"]]} />
          </Section>
        </div>
      )}

      {tab === "guardians" && (
        <Section
          title="Parents & guardians"
          description="Guardians with portal access see only what is ticked for them."
          actions={canUpdate && <FormDialog title="Guardian" fields={GUARDIAN_FIELDS} columns={2} action={saveGuardianAction.bind(null, id)} initial={{ relation: "FATHER", canViewAcademic: true, canViewFinance: true, isPrimary: s.guardians.length === 0 }} trigger={<Button size="xs" variant="outline"><UserPlus /> Add guardian</Button>} />}
          bodyClassName="p-0"
        >
          {s.guardians.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">No guardians recorded.</p>
          ) : (
            <DataTable head={[{ label: "Name" }, { label: "Contact" }, { label: "Can see" }, { label: "Portal" }, { label: "" }]}>
              {s.guardians.map((g) => (
                <tr key={g.id}>
                  <Td><div className="font-medium">{g.name}{g.isPrimary && <span className="ml-2 rounded-full bg-primary/10 px-2 text-[11px] font-semibold text-primary">Primary</span>}</div><div className="text-[11px] text-muted-foreground">{GUARDIAN_RELATION_LABEL[g.relation]}{g.occupation ? ` · ${g.occupation}` : ""}</div></Td>
                  <Td className="text-xs">{g.phone ?? "—"}<div className="text-muted-foreground">{g.email ?? ""}</div></Td>
                  <Td className="text-xs">{[g.canViewAcademic && "Academics", g.canViewFinance && "Fees"].filter(Boolean).join(", ") || "Nothing"}</Td>
                  <Td className="text-xs">{g.user ? `Linked · ${g.user.lastLoginAt ? `last sign-in ${fmtDate(g.user.lastLoginAt)}` : "not signed in yet"}` : canUpdate && g.email ? <ProvisionAccountButton studentId={id} guardianId={g.id} label="Give portal access" /> : "—"}</Td>
                  <Td className="text-right whitespace-nowrap">
                    {canUpdate && (
                      <>
                        <FormDialog title="Guardian" fields={GUARDIAN_FIELDS} columns={2} action={saveGuardianAction.bind(null, id)} id={g.id} initial={{ name: g.name, relation: g.relation, occupation: g.occupation, phone: g.phone, email: g.email, isPrimary: g.isPrimary, canViewAcademic: g.canViewAcademic, canViewFinance: g.canViewFinance }} />
                        <RemoveGuardianButton studentId={id} guardianId={g.id} name={g.name} />
                      </>
                    )}
                  </Td>
                </tr>
              ))}
            </DataTable>
          )}
        </Section>
      )}

      {tab === "academics" && <AcademicsTab studentId={id} termId={term?.id ?? null} termName={term?.name ?? null} />}
      {tab === "progress" && <ProgressTab studentId={id} />}
      {tab === "results" && can(ctx, "result.view", s.departmentId) && <ResultsTab studentId={id} />}
      {tab === "nep" && <NepPanel ctx={ctx} studentId={id} self={false} />}
      {tab === "support" && <SupportPanel ctx={ctx} studentId={id} self={false} />}
      {tab === "documents" && <StudentDocumentsTab studentId={id} canUpload={canUpdate} canVerify={can(ctx, "document.verify", s.departmentId)} />}
      {tab === "credentials" && <CredentialsTab studentId={id} graduated={s.status === "GRADUATED"} />}
      {tab === "fees" && can(ctx, "finance.view", s.departmentId) && <FeesTab studentId={id} />}
      {tab === "history" && staff && <HistoryTab studentId={id} showAudit={can(ctx, "audit.view") || canUpdate} />}
    </div>
  );

  async function AcademicsTab({ studentId, termId, termName }: { studentId: string; termId: string | null; termName: string | null }) {
    const [att, regs] = await Promise.all([
      termId ? studentAttendance(ctx, studentId, termId) : null,
      db.courseRegistration.findMany({ where: { studentId }, include: { offering: { include: { course: { select: { code: true, title: true, credits: true } }, term: { select: { name: true, startDate: true } } } } }, orderBy: [{ offering: { term: { startDate: "desc" } } }, { offering: { course: { code: "asc" } } }] }),
    ]);
    const byTerm = regs.reduce<Record<string, typeof regs>>((a, r) => ((a[r.offering.term.name] ??= []).push(r), a), {});
    return (
      <div className="space-y-6">
        {att && (
          <Section title={`Attendance — ${termName}`} description={`Minimum ${att.policy.minimumPercent}% · condonation from ${att.policy.condonationPercent}%`} actions={att.overallPercent !== null && <span className="text-sm font-semibold tabular">{att.overallPercent}% overall</span>} bodyClassName="p-0">
            {att.classes.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">No classes this term.</p>
            ) : (
              <DataTable head={[{ label: "Course" }, { label: "Held", className: "text-right" }, { label: "Attended", className: "text-right" }, { label: "%", className: "text-right" }, { label: "Standing" }]}>
                {att.classes.map((c) => (
                  <tr key={c.offeringId}>
                    <Td><span className="font-mono text-xs text-muted-foreground">{c.code}</span> {c.title}</Td>
                    <Td className="text-right tabular">{c.summary.counted}</Td>
                    <Td className="text-right tabular">{c.summary.attended}</Td>
                    <Td className="text-right tabular font-medium">{c.summary.percent ?? "—"}</Td>
                    <Td className={cn("text-xs", c.summary.standing === "SHORTAGE" && "font-medium text-tone-danger", c.summary.standing === "CONDONABLE" && "text-tone-warning", c.summary.standing === "AT_RISK" && "text-tone-warning")}>
                      {STANDING_LABEL[c.summary.standing]}
                      {c.summary.standing === "OK" || c.summary.standing === "AT_RISK" ? (c.summary.canMiss !== null ? ` · can miss ${c.summary.canMiss}` : "") : c.summary.mustAttend ? ` · attend next ${c.summary.mustAttend}` : ""}
                    </Td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Section>
        )}
        <Section title="Course registrations" bodyClassName="p-0">
          {regs.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">No registrations yet.</p>
          ) : (
            Object.entries(byTerm).map(([termLabel, list]) => (
              <div key={termLabel}>
                <div className="border-b bg-muted/40 px-5 py-2 text-xs font-semibold">{termLabel} · {list.filter((r) => r.status !== "DROPPED").reduce((a, r) => a + r.offering.course.credits, 0)} credits</div>
                <DataTable head={[{ label: "Course" }, { label: "Section" }, { label: "Credits", className: "text-right" }, { label: "Attempt" }, { label: "Status" }]}>
                  {list.map((r) => (
                    <tr key={r.id}>
                      <Td><span className="font-mono text-xs text-muted-foreground">{r.offering.course.code}</span> {r.offering.course.title}</Td>
                      <Td className="text-xs">{r.offering.section}</Td>
                      <Td className="text-right tabular">{r.offering.course.credits}</Td>
                      <Td className="text-xs">{r.attemptType.charAt(0) + r.attemptType.slice(1).toLowerCase()}</Td>
                      <Td><StatusBadge meta={REGISTRATION_STATUS[r.status]} /></Td>
                    </tr>
                  ))}
                </DataTable>
              </div>
            ))
          )}
        </Section>
      </div>
    );
  }

  async function ProgressTab({ studentId }: { studentId: string }) {
    const p = await degreeProgress(ctx, studentId);
    if (!p) return <Section title="Degree progress"><p className="text-sm text-muted-foreground">No active curriculum is set for this programme. An academic administrator can define one under Curricula.</p></Section>;
    const a = p.audit;
    return (
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Section title="Degree progress" description={`${p.curriculum.name} · version ${p.curriculum.version}`}>
          <div className="mb-2 flex items-end justify-between">
            <span className="text-3xl font-semibold tabular">{a.percent}%</span>
            <span className="text-sm text-muted-foreground tabular">{a.earnedCredits} / {a.requiredCredits} credits</span>
          </div>
          <Progress value={a.percent} aria-label="Credits completed" />
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-muted-foreground">Mandatory courses</dt><dd className="font-medium tabular">{a.mandatory.done} of {a.mandatory.total}</dd></div>
            {a.electives.map((e) => <div key={e.code}><dt className="text-muted-foreground">{e.name}</dt><dd className="font-medium tabular">{e.earned} / {e.required} credits</dd></div>)}
            {a.categories.map((c) => <div key={c.label}><dt className="text-muted-foreground">{c.label}</dt><dd className="font-medium">{c.met ? "Completed" : `${c.earned} / ${c.required} credits`}</dd></div>)}
          </dl>
          {a.mandatory.remaining.length > 0 && (
            <>
              <h3 className="mt-6 mb-2 text-sm font-semibold">Mandatory courses remaining</h3>
              <ul className="grid gap-1 text-sm sm:grid-cols-2">
                {a.mandatory.remaining.map((c) => <li key={c.code}><span className="font-mono text-xs text-muted-foreground">{c.code}</span> {c.title} <span className="text-xs text-muted-foreground">· sem {c.semester}</span></li>)}
              </ul>
            </>
          )}
        </Section>
        <Section title="Graduation eligibility">
          {a.eligible ? (
            <p className="flex items-center gap-2 text-sm font-medium text-tone-success"><CheckCircle2 className="size-4" /> All requirements met</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {a.blockers.map((b) => <li key={b} className="flex gap-2"><CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-tone-warning" />{b}</li>)}
            </ul>
          )}
          <p className="mt-4 text-xs text-muted-foreground">Based on completed courses. Grades and CGPA are added when results are published.</p>
        </Section>
      </div>
    );
  }

  async function ResultsTab({ studentId }: { studentId: string }) {
    const { courses, terms, cgpa } = await studentResults(ctx, studentId);
    const history = await db.courseResult.findMany({ where: { studentId, isCurrent: false }, include: { course: { select: { code: true } } }, orderBy: { createdAt: "desc" } });
    return (
      <div className="space-y-6">
        <Section title="Results" description={`CGPA ${cgpa ?? "—"} · ${terms.length} term(s)`} bodyClassName="p-0">
          {courses.length === 0 ? <p className="px-5 py-4 text-sm text-muted-foreground">No results yet.</p> : (
            <DataTable head={[{ label: "Term" }, { label: "Course" }, { label: "Int", className: "text-right" }, { label: "Ext", className: "text-right" }, { label: "Grade" }, { label: "Result" }, { label: "Published" }]}>
              {courses.map((c) => (
                <tr key={c.id}>
                  <Td className="text-xs whitespace-nowrap">{c.run.term.name}</Td>
                  <Td><span className="font-mono text-xs text-muted-foreground">{c.course.code}</span> {c.course.title}{c.version > 1 && <span className="ml-1 text-[11px] text-muted-foreground">v{c.version}</span>}</Td>
                  <Td className="text-right tabular">{c.internalMarks ?? "—"}</Td>
                  <Td className="text-right tabular">{c.externalMarks ?? "—"}{c.graceMarks ? ` +${c.graceMarks}` : ""}</Td>
                  <Td className="font-semibold">{c.grade}</Td>
                  <Td><StatusBadge meta={COURSE_RESULT_STATUS[c.status]} /></Td>
                  <Td className="text-xs">{c.publishedAt ? fmtDate(c.publishedAt) : "Not yet"}</Td>
                </tr>
              ))}
            </DataTable>
          )}
        </Section>
        {history.length > 0 && (
          <Section title="Superseded versions" description="Kept permanently; revisions never overwrite a result." bodyClassName="p-0">
            <DataTable head={[{ label: "Course" }, { label: "Version" }, { label: "Grade" }, { label: "Marks", className: "text-right" }, { label: "Recorded" }]}>
              {history.map((h) => <tr key={h.id}><Td className="text-xs">{h.course.code}</Td><Td className="text-xs">v{h.version}</Td><Td>{h.grade}</Td><Td className="text-right tabular">{h.totalMarks ?? "—"}</Td><Td className="text-xs">{fmtDateTime(h.createdAt)}</Td></tr>)}
            </DataTable>
          </Section>
        )}
      </div>
    );
  }

  async function FeesTab({ studentId }: { studentId: string }) {
    const [invoices, payments, inst] = await Promise.all([
      db.invoice.findMany({ where: { studentId }, orderBy: { issueDate: "desc" } }),
      db.payment.findMany({ where: { studentId }, orderBy: { receivedAt: "desc" }, take: 20 }),
      db.institution.findFirstOrThrow({ select: { currency: true, locale: true } }),
    ]);
    const fmt = (m: number) => formatMoney(m, inst.currency, inst.locale);
    const outstanding = invoices.filter((i) => i.status === "ISSUED" || i.status === "PARTIALLY_PAID").reduce((a, i) => a + toMinor(i.total) - toMinor(i.amountPaid), 0);
    return (
      <div className="space-y-6">
        <Section title="Invoices" description={`Outstanding ${fmt(outstanding)}`} actions={can(ctx, "payment.record") && outstanding > 0 && <RecordPaymentDialog studentId={studentId} balance={outstanding} currency={inst.currency} />} bodyClassName="p-0">
          {invoices.length === 0 ? <p className="px-5 py-4 text-sm text-muted-foreground">No invoices.</p> : (
            <DataTable head={[{ label: "Invoice" }, { label: "Due" }, { label: "Total", className: "text-right" }, { label: "Paid", className: "text-right" }, { label: "Status" }]}>
              {invoices.map((i) => <tr key={i.id}><Td><Link href={`/finance/invoices/${i.id}`} className="font-mono text-xs hover:text-primary">{i.number}</Link></Td><Td className="text-xs">{fmtDate(i.dueDate)}</Td><Td className="text-right tabular">{fmt(toMinor(i.total))}</Td><Td className="text-right tabular">{fmt(toMinor(i.amountPaid))}</Td><Td><StatusBadge meta={INVOICE_STATUS[i.status]} /></Td></tr>)}
            </DataTable>
          )}
        </Section>
        {payments.length > 0 && (
          <Section title="Payments" bodyClassName="p-0">
            <DataTable head={[{ label: "Receipt" }, { label: "Date" }, { label: "Amount", className: "text-right" }, { label: "Status" }]}>
              {payments.map((p) => <tr key={p.id}><Td><Link href={`/finance/payments/${p.id}`} className="font-mono text-xs hover:text-primary">{p.receiptNo ?? "—"}</Link></Td><Td className="text-xs">{fmtDate(p.receivedAt)}</Td><Td className="text-right tabular">{fmt(toMinor(p.amount))}</Td><Td><StatusBadge meta={PAYMENT_STATUS[p.status]} /></Td></tr>)}
            </DataTable>
          </Section>
        )}
      </div>
    );
  }

  async function CredentialsTab({ studentId, graduated }: { studentId: string; graduated: boolean }) {
    const [creds, terms] = await Promise.all([
      db.issuedCredential.findMany({ where: { studentId }, orderBy: { issuedAt: "desc" } }),
      db.termResult.findMany({ where: { studentId, isCurrent: true, publishedAt: { not: null } }, include: { run: { select: { term: { select: { name: true } } } } } }),
    ]);
    const issue = can(ctx, "credential.issue");
    return (
      <Section
        title="Certificates & transcripts"
        actions={issue && (
          <div className="flex flex-wrap justify-end gap-1">
            <IssueCredentialButton studentId={studentId} type="BONAFIDE_CERTIFICATE" label="Bonafide" />
            {terms.length > 0 && <IssueCredentialButton studentId={studentId} type="TRANSCRIPT" label="Transcript" />}
            {terms.map((t) => <IssueCredentialButton key={t.id} studentId={studentId} type="MARKSHEET" termId={t.termId} label={`Marks: ${t.run.term.name}`} />)}
            {graduated && <IssueCredentialButton studentId={studentId} type="PROVISIONAL_CERTIFICATE" label="Provisional" />}
            {graduated && <IssueCredentialButton studentId={studentId} type="DEGREE_CERTIFICATE" label="Degree" />}
            <IssueCredentialButton studentId={studentId} type="TRANSFER_CERTIFICATE" label="Transfer" />
          </div>
        )}
        bodyClassName="p-0"
      >
        {creds.length === 0 ? <p className="px-5 py-4 text-sm text-muted-foreground">Nothing issued yet.</p> : (
          <DataTable head={[{ label: "Document" }, { label: "Serial" }, { label: "Issued" }, { label: "Status" }]}>
            {creds.map((c) => <tr key={c.id}><Td><Link href={`/credentials/${c.id}`} className="font-medium hover:text-primary">{c.title}</Link></Td><Td className="font-mono text-xs">{c.serialNo}</Td><Td className="text-xs">{fmtDate(c.issuedAt)}</Td><Td><StatusBadge meta={CREDENTIAL_STATUS[c.status]} /></Td></tr>)}
          </DataTable>
        )}
      </Section>
    );
  }

  async function HistoryTab({ studentId, showAudit }: { studentId: string; showAudit: boolean }) {
    const [changes, requests, events] = await Promise.all([
      db.studentStatusChange.findMany({ where: { studentId }, orderBy: { createdAt: "desc" } }),
      db.workflowInstance.findMany({ where: { resourceType: "student", resourceId: studentId }, orderBy: { createdAt: "desc" }, take: 10 }),
      showAudit ? db.auditLog.findMany({ where: { resourceType: "student", resourceId: studentId }, orderBy: { id: "desc" }, take: 25 }) : [],
    ]);
    return (
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Status changes" bodyClassName="p-0">
          {changes.length === 0 ? <p className="px-5 py-4 text-sm text-muted-foreground">No status changes.</p> : (
            <DataTable head={[{ label: "Change" }, { label: "Effective" }, { label: "Reason" }]}>
              {changes.map((c) => (
                <tr key={c.id}>
                  <Td className="text-xs whitespace-nowrap">{STUDENT_STATUS[c.from].label} → {STUDENT_STATUS[c.to].label}</Td>
                  <Td className="text-xs whitespace-nowrap">{fmtDate(c.effectiveOn)}</Td>
                  <Td className="text-xs">{c.reason}</Td>
                </tr>
              ))}
            </DataTable>
          )}
          {requests.length > 0 && (
            <ul className="divide-y border-t text-sm">
              {requests.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-5 py-2.5"><StatusBadge meta={WORKFLOW_STATUS[r.status]} /><Link href={`/inbox/requests/${r.id}`} className="min-w-0 flex-1 truncate hover:text-primary">{r.title}</Link><span className="text-xs text-muted-foreground">{fmtDate(r.createdAt)}</span></li>
              ))}
            </ul>
          )}
        </Section>
        {showAudit && (
          <Section title="Record activity" bodyClassName="p-0">
            <ul className="divide-y text-sm">
              {events.map((e) => (
                <li key={e.id.toString()} className="flex gap-3 px-5 py-2.5">
                  <code className="shrink-0 rounded bg-muted px-1.5 text-[11px]">{e.action}</code>
                  <span className="min-w-0 flex-1">{e.summary}<span className="block text-[11px] text-muted-foreground">{e.actorName ?? "System"} · {fmtDateTime(e.createdAt)}</span></span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    );
  }
}
