import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, LinkTabs, Td } from "@/components/app/list";
import { FormDialog, type FormField } from "@/components/app/form-dialog";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { generateMeetingsAction, saveOfferingAction } from "@/features/academic-ops/actions";
import { ActionButton } from "@/features/academic-ops/controls";
import { DropButton, InstructorEditor, RegisterStudents, RemoveSlotButton, SlotForm } from "@/features/academic-ops/offering-panels";
import { STANDING_LABEL } from "@/lib/domain/attendance";
import { OFFERING_STATUS, REGISTRATION_STATUS, SHEET_STATUS } from "@/lib/domain/labels";
import { DAY_NAMES } from "@/lib/domain/timetable";
import { fmtDate, fmtDateTime, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { offeringAttendanceReport } from "@/server/services/attendance";
import { componentsFor } from "@/server/services/marks";
import { saveComponentAction } from "@/features/results/actions";
import { getInstitution } from "@/server/services/directory";
import { loadOfferingFor } from "@/server/services/offerings";

export const metadata: Metadata = { title: "Class" };

export default async function OfferingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab = "overview" } = await searchParams;
  const ctx = await requirePageAuth(["academic.view", "enrollment.manage", "attendance.take"]);
  const base = await loadOfferingFor(ctx, id).catch(() => null);
  if (!base) notFound();
  const dept = base.course.departmentId;
  const manage = can(ctx, "enrollment.manage", dept);
  const timetable = manage || can(ctx, "timetable.manage", dept);
  const o = await db.courseOffering.findUniqueOrThrow({
    where: { id },
    include: {
      course: { select: { code: true, title: true, credits: true, courseType: true, department: { select: { name: true } } } },
      term: true,
      batch: { select: { code: true } },
      instructors: { include: { user: { select: { id: true, name: true, designation: true, department: { select: { code: true } } } } }, orderBy: { isPrimary: "desc" } },
      slots: { include: { room: { select: { code: true } } }, orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }] },
      _count: { select: { registrations: { where: { status: "REGISTERED" } } } },
    },
  });
  const tabs = [
    { key: "overview", label: "Overview", href: `/academics/offerings/${id}` },
    { key: "students", label: "Students", count: o._count.registrations, href: `/academics/offerings/${id}?tab=students` },
    { key: "sessions", label: "Sessions", href: `/academics/offerings/${id}?tab=sessions` },
    { key: "attendance", label: "Attendance", href: `/academics/offerings/${id}?tab=attendance` },
    { key: "marks", label: "Internal marks", href: `/academics/offerings/${id}?tab=marks` },
  ];
  const [rooms, batches, terms] = await Promise.all([
    timetable ? db.room.findMany({ where: { isActive: true }, orderBy: { code: "asc" }, select: { id: true, code: true, capacity: true } }) : [],
    manage ? db.batch.findMany({ where: { deletedAt: null }, orderBy: [{ admissionYear: "desc" }, { code: "asc" }], select: { id: true, code: true } }) : [],
    manage ? db.academicTerm.findMany({ orderBy: { startDate: "desc" }, take: 12 }) : [],
  ]);
  const editFields: FormField[] = [
    { name: "courseId", label: "Course", type: "select", options: [{ value: o.courseId, label: `${o.course.code} — ${o.course.title}` }], wide: true },
    { name: "termId", label: "Term", type: "select", options: terms.map((t) => ({ value: t.id, label: t.name })) },
    { name: "section", label: "Section", type: "text", upper: true },
    { name: "batchId", label: "Reserved for batch", type: "select", optional: true, options: batches.map((b) => ({ value: b.id, label: b.code })) },
    { name: "capacity", label: "Capacity", type: "number", min: 1 },
    { name: "status", label: "Status", type: "select", options: Object.entries(OFFERING_STATUS).map(([value, m]) => ({ value, label: m.label })) },
    { name: "notes", label: "Notes", type: "textarea", optional: true },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Classes", href: "/academics/offerings" }, { label: `${o.course.code}-${o.section}` }]}
        eyebrow={<span className="font-mono">{o.course.code} · section {o.section}</span>}
        title={<span className="flex flex-wrap items-center gap-3">{o.course.title} <StatusBadge meta={OFFERING_STATUS[o.status]} size="md" /></span>}
        description={`${o.term.name} · ${o.course.credits} credits · ${o.batch ? `batch ${o.batch.code}` : "open to all eligible students"}`}
        actions={manage && <FormDialog title="Class" fields={editFields} columns={2} action={saveOfferingAction} id={o.id} initial={{ courseId: o.courseId, termId: o.termId, section: o.section, batchId: o.batchId, capacity: o.capacity, status: o.status, notes: o.notes }} trigger={<Button size="sm" variant="outline">Edit class</Button>} />}
      />
      <LinkTabs tabs={tabs} active={tab} />

      {tab === "overview" && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Section title="Instructors">
            {manage ? (
              <InstructorEditor offeringId={id} current={o.instructors.map((i) => ({ id: i.user.id, name: i.user.name, subtitle: [i.user.designation, i.user.department?.code].filter(Boolean).join(" · "), isPrimary: i.isPrimary }))} />
            ) : (
              <ul className="space-y-1 text-sm">{o.instructors.map((i) => <li key={i.userId}>{i.user.name}{i.isPrimary && <span className="text-muted-foreground"> (primary)</span>}</li>)}</ul>
            )}
          </Section>
          <Section title="Details">
            <KeyValue items={[["Department", o.course.department.name], ["Capacity", `${o._count.registrations} registered of ${o.capacity}`], ["Teaching period", `${fmtDate(o.term.startDate)} – ${fmtDate(o.term.endDate)}`], ["Registration", o.term.registrationOpensAt ? `${fmtDateTime(o.term.registrationOpensAt)} – ${fmtDateTime(o.term.addDropUntil ?? o.term.registrationClosesAt)}` : "No window set"], ["Notes", o.notes ?? "—"]]} />
          </Section>
          <Section
            title="Weekly timetable"
            className="xl:col-span-2"
            actions={timetable && o.slots.length > 0 && <ActionButton run={generateMeetingsAction.bind(null, id)} label="Generate class sessions" icon={<CalendarPlus />} confirmText="Create dated class sessions for the rest of the term from this timetable (holidays are skipped)?" />}
          >
            {o.slots.length === 0 ? <p className="mb-4 text-sm text-muted-foreground">No weekly slots yet.</p> : (
              <ul className="mb-5 divide-y rounded-lg border text-sm">
                {o.slots.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-2">
                    <span className="w-24 font-medium">{DAY_NAMES[s.dayOfWeek]}</span>
                    <span className="tabular">{s.startTime}–{s.endTime}</span>
                    <span className="text-muted-foreground">{s.room?.code ?? "No room"} · {s.kind.toLowerCase()}</span>
                    <span className="ml-auto">{timetable && <RemoveSlotButton slotId={s.id} offeringId={id} />}</span>
                  </li>
                ))}
              </ul>
            )}
            {timetable && <SlotForm offeringId={id} rooms={rooms.map((r) => ({ id: r.id, label: `${r.code} (${r.capacity})` }))} />}
          </Section>
        </div>
      )}

      {tab === "students" && <StudentsTab />}
      {tab === "sessions" && <SessionsTab />}
      {tab === "attendance" && <AttendanceTab />}
      {tab === "marks" && <MarksTab />}
    </div>
  );

  async function StudentsTab() {
    const regs = await db.courseRegistration.findMany({
      where: { offeringId: id },
      include: { student: { select: { id: true, studentNo: true, firstName: true, lastName: true, section: true, batch: { select: { code: true } } } } },
      orderBy: [{ status: "asc" }, { student: { lastName: "asc" } }],
    });
    return (
      <Section title="Registered students" actions={manage && <RegisterStudents offeringId={id} batches={batches.map((b) => ({ id: b.id, label: b.code }))} />} bodyClassName="p-0">
        {regs.length === 0 ? <p className="px-5 py-4 text-sm text-muted-foreground">No students registered.</p> : (
          <DataTable head={[{ label: "Student" }, { label: "Batch" }, { label: "Attempt" }, { label: "Registered" }, { label: "Status" }, { label: "" }]}>
            {regs.map((r) => (
              <tr key={r.id}>
                <Td>{can(ctx, "student.view") ? <Link href={`/students/${r.student.id}`} className="hover:text-primary">{r.student.firstName} {r.student.lastName}</Link> : `${r.student.firstName} ${r.student.lastName}`}<div className="font-mono text-[11px] text-muted-foreground">{r.student.studentNo}</div></Td>
                <Td className="text-xs">{r.student.batch.code}{r.student.section ? ` · ${r.student.section}` : ""}</Td>
                <Td className="text-xs">{r.attemptType.charAt(0) + r.attemptType.slice(1).toLowerCase()}</Td>
                <Td className="text-xs whitespace-nowrap">{fmtDate(r.registeredAt)}</Td>
                <Td><StatusBadge meta={REGISTRATION_STATUS[r.status]} /></Td>
                <Td className="text-right">{manage && r.status === "REGISTERED" && <DropButton registrationId={r.id} />}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
    );
  }

  async function SessionsTab() {
    const inst = await getInstitution();
    const meetings = await db.classMeeting.findMany({ where: { offeringId: id }, orderBy: { startsAt: "asc" }, include: { room: { select: { code: true } }, _count: { select: { records: true } } } });
    const now = new Date();
    return (
      <Section title="Class sessions" description={`${meetings.filter((m) => m.status === "HELD").length} held · ${meetings.filter((m) => m.status === "SCHEDULED").length} scheduled`} bodyClassName="p-0">
        {meetings.length === 0 ? <p className="px-5 py-4 text-sm text-muted-foreground">No sessions yet. Add weekly slots and generate sessions on the Overview tab.</p> : (
          <DataTable head={[{ label: "Date" }, { label: "Time" }, { label: "Room" }, { label: "Topic" }, { label: "Attendance" }]}>
            {meetings.map((m) => (
              <tr key={m.id} className={cn(m.status === "CANCELLED" && "opacity-50")}>
                <Td className="text-xs whitespace-nowrap">{fmtDate(m.date)}</Td>
                <Td className="text-xs tabular">{fmtTime(m.startsAt, inst.timezone)}–{fmtTime(m.endsAt, inst.timezone)}</Td>
                <Td className="text-xs">{m.room?.code ?? "—"}</Td>
                <Td className="text-xs">{m.topic ?? "—"}</Td>
                <Td className="text-xs">{m.status === "CANCELLED" ? "Cancelled" : m.status === "HELD" ? <Link href={`/teaching/sessions/${m.id}`} className="hover:text-primary">{m._count.records} marked</Link> : m.startsAt.getTime() - now.getTime() < 30 * 60_000 ? <Link href={`/teaching/sessions/${m.id}`} className="font-medium text-primary hover:underline">Take attendance</Link> : "Scheduled"}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
    );
  }

  async function MarksTab() {
    const data = await componentsFor(ctx, id).catch(() => null);
    if (!data) return <Section title="Internal marks"><p className="text-sm text-muted-foreground">You do not have access to this class&apos;s marks.</p></Section>;
    const canEdit = data.instructor || data.manage;
    const fields: FormField[] = [
      { name: "name", label: "Name", type: "text", placeholder: "e.g. CAT I" },
      { name: "kind", label: "Type", type: "select", options: [{ value: "INTERNAL", label: "Test / assignment" }, { value: "PRACTICAL", label: "Practical" }, { value: "VIVA", label: "Viva" }, { value: "PROJECT", label: "Project" }] },
      { name: "maxMarks", label: "Marked out of", type: "number", min: 1 },
      { name: "weight", label: "Counts for (marks)", type: "number", min: 0, step: 0.5, hint: `Components together make up the ${data.offering.course.internalMarks} internal marks.` },
      { name: "order", label: "Order", type: "number", min: 0 },
    ];
    return (
      <Section
        title="Internal assessment"
        description={`${data.weightTotal} of ${data.offering.course.internalMarks} internal marks allocated. The end-semester examination is added from answer-script valuation.`}
        actions={canEdit && <FormDialog title="Component" fields={fields} action={saveComponentAction.bind(null, id)} initial={{ kind: "INTERNAL", maxMarks: 50, weight: Math.max(0, data.offering.course.internalMarks - data.weightTotal), order: data.components.length + 1 }} />}
        bodyClassName="p-0"
      >
        {data.components.length === 0 ? <p className="px-5 py-4 text-sm text-muted-foreground">No components yet.</p> : (
          <DataTable head={[{ label: "Component" }, { label: "Out of", className: "text-right" }, { label: "Counts for", className: "text-right" }, { label: "Marks entered", className: "text-right" }, { label: "Status" }, { label: "" }]}>
            {data.components.map((c) => (
              <tr key={c.id}>
                <Td><Link href={`/academics/offerings/${id}/marks/${c.id}`} className="font-medium hover:text-primary">{c.name}</Link><div className="text-[11px] text-muted-foreground">{c.kind.toLowerCase()}</div></Td>
                <Td className="text-right tabular">{c.maxMarks}</Td>
                <Td className="text-right tabular">{c.weight}</Td>
                <Td className="text-right tabular">{c._count.marks}</Td>
                <Td><StatusBadge meta={SHEET_STATUS[c.sheet?.status ?? "DRAFT"]} /></Td>
                <Td className="text-right">{canEdit && (c.sheet?.status ?? "DRAFT") !== "APPROVED" && c.sheet?.status !== "SUBMITTED" && <FormDialog title="Component" fields={fields} action={saveComponentAction.bind(null, id)} id={c.id} initial={{ name: c.name, kind: c.kind, maxMarks: c.maxMarks, weight: c.weight, order: c.order }} />}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
    );
  }

  async function AttendanceTab() {
    const report = await offeringAttendanceReport(ctx, id).catch(() => null);
    if (!report) return <Section title="Attendance"><p className="text-sm text-muted-foreground">You do not have access to this class&apos;s attendance.</p></Section>;
    return (
      <Section title="Attendance summary" description={`${report.held} sessions held, ${report.remaining} remaining · minimum ${report.policy.minimumPercent}%`} bodyClassName="p-0">
        <DataTable head={[{ label: "Student" }, { label: "Attended", className: "text-right" }, { label: "%", className: "text-right" }, { label: "Standing" }]}>
          {report.rows.map((r) => (
            <tr key={r.student.id}>
              <Td>{r.student.firstName} {r.student.lastName}<div className="font-mono text-[11px] text-muted-foreground">{r.student.studentNo}</div></Td>
              <Td className="text-right tabular">{r.summary.attended} / {r.summary.counted}</Td>
              <Td className="text-right tabular font-medium">{r.summary.percent ?? "—"}</Td>
              <Td className={cn("text-xs", r.summary.standing === "SHORTAGE" && "font-medium text-tone-danger", (r.summary.standing === "CONDONABLE" || r.summary.standing === "AT_RISK") && "text-tone-warning")}>{STANDING_LABEL[r.summary.standing]}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    );
  }
}
