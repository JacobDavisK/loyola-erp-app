import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { FormDialog, type FormField } from "@/components/app/form-dialog";
import { PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { DeleteEventButton } from "@/features/academic-ops/controls";
import { saveSetupAction } from "@/features/academic-ops/actions";
import { TERM_STATUS } from "@/lib/domain/labels";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { hasGlobal, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Terms & calendar" };

const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);
const dt = (x: Date | null) => (x ? x.toISOString().slice(0, 16) : null);
const KIND = { TERM: "Term dates", HOLIDAY: "Holiday", EXAMINATION: "Examinations", REGISTRATION: "Registration", EVENT: "Event", DEADLINE: "Deadline" } as const;

export default async function TermsPage() {
  const ctx = await requirePageAuth(["academic.view", "enrollment.manage"]);
  const manage = hasGlobal(ctx, "enrollment.manage");
  const [terms, years, events] = await Promise.all([
    db.academicTerm.findMany({ orderBy: { startDate: "desc" }, include: { academicYear: { select: { label: true } }, _count: { select: { offerings: true } } } }),
    db.academicYear.findMany({ orderBy: { startDate: "desc" } }),
    db.calendarEvent.findMany({ where: { endDate: { gte: new Date(new Date().getTime() - 60 * 86_400_000) } }, orderBy: { startDate: "asc" }, take: 60, include: { term: { select: { code: true } } } }),
  ]);
  const termFields: FormField[] = [
    { name: "code", label: "Code", type: "text", upper: true, placeholder: "2026-27-ODD" },
    { name: "name", label: "Name", type: "text", placeholder: "2026–27 Odd term" },
    { name: "academicYearId", label: "Academic year", type: "select", options: years.map((y) => ({ value: y.id, label: y.label })) },
    { name: "termType", label: "Term", type: "select", options: [{ value: "ODD", label: "Odd" }, { value: "EVEN", label: "Even" }] },
    { name: "startDate", label: "Teaching starts", type: "date" },
    { name: "endDate", label: "Teaching ends", type: "date" },
    { name: "registrationOpensAt", label: "Registration opens", type: "datetime-local", optional: true },
    { name: "registrationClosesAt", label: "Registration closes", type: "datetime-local", optional: true },
    { name: "addDropUntil", label: "Add/drop until", type: "datetime-local", optional: true },
    { name: "status", label: "Status", type: "select", options: Object.entries(TERM_STATUS).map(([value, m]) => ({ value, label: m.label })) },
    { name: "isCurrent", label: "Current term", type: "checkbox" },
  ];
  const eventFields: FormField[] = [
    { name: "title", label: "Title", type: "text", wide: true },
    { name: "kind", label: "Type", type: "select", options: Object.entries(KIND).map(([value, label]) => ({ value, label })) },
    { name: "termId", label: "Term", type: "select", optional: true, options: terms.map((t) => ({ value: t.id, label: t.name })) },
    { name: "startDate", label: "From", type: "date" },
    { name: "endDate", label: "To", type: "date" },
    { name: "isHoliday", label: "No classes (holiday)", type: "checkbox", wide: true },
    { name: "description", label: "Description", type: "textarea", optional: true },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Terms & academic calendar" description="Teaching terms with registration windows, and the calendar of holidays, examinations and deadlines. Holidays are skipped when class sessions are generated." />
      <Section title="Terms" actions={manage && <FormDialog title="Term" fields={termFields} columns={2} action={saveSetupAction.bind(null, "term")} initial={{ status: "PLANNED", termType: "ODD" }} />} bodyClassName="p-0">
        <DataTable head={[{ label: "Term" }, { label: "Teaching" }, { label: "Registration" }, { label: "Classes", className: "text-right" }, { label: "Status" }, { label: "" }]}>
          {terms.map((t) => (
            <tr key={t.id}>
              <Td><div className="font-medium">{t.name}{t.isCurrent && <span className="ml-2 rounded-full bg-primary/10 px-2 text-[11px] font-semibold text-primary">Current</span>}</div><div className="font-mono text-[11px] text-muted-foreground">{t.code} · {t.academicYear.label}</div></Td>
              <Td className="text-xs whitespace-nowrap">{fmtDate(t.startDate)} – {fmtDate(t.endDate)}</Td>
              <Td className="text-xs">{t.registrationOpensAt ? `${fmtDateTime(t.registrationOpensAt)} – ${fmtDateTime(t.registrationClosesAt)}` : "—"}{t.addDropUntil && <div className="text-muted-foreground">add/drop until {fmtDate(t.addDropUntil)}</div>}</Td>
              <Td className="text-right tabular">{t._count.offerings}</Td>
              <Td><StatusBadge meta={TERM_STATUS[t.status]} /></Td>
              <Td className="text-right">
                {manage && (
                  <FormDialog title="Term" fields={termFields} columns={2} action={saveSetupAction.bind(null, "term")} id={t.id}
                    initial={{ code: t.code, name: t.name, academicYearId: t.academicYearId, termType: t.termType, startDate: d(t.startDate), endDate: d(t.endDate), registrationOpensAt: dt(t.registrationOpensAt), registrationClosesAt: dt(t.registrationClosesAt), addDropUntil: dt(t.addDropUntil), status: t.status, isCurrent: t.isCurrent }} />
                )}
              </Td>
            </tr>
          ))}
        </DataTable>
        {terms.length === 0 && <p className="px-5 py-4 text-sm text-muted-foreground">No terms defined yet.</p>}
      </Section>
      <Section title="Academic calendar" description="Upcoming and recent events" actions={manage && <FormDialog title="Calendar event" fields={eventFields} columns={2} action={saveSetupAction.bind(null, "calendarEvent")} initial={{ kind: "HOLIDAY", isHoliday: true }} />} bodyClassName="p-0">
        <DataTable head={[{ label: "Date" }, { label: "Event" }, { label: "Type" }, { label: "" }]}>
          {events.map((e) => (
            <tr key={e.id}>
              <Td className="text-xs whitespace-nowrap">{fmtDate(e.startDate)}{e.endDate.getTime() !== e.startDate.getTime() ? ` – ${fmtDate(e.endDate)}` : ""}</Td>
              <Td>{e.title}{e.description && <div className="text-[11px] text-muted-foreground">{e.description}</div>}</Td>
              <Td className="text-xs">{KIND[e.kind]}{e.isHoliday ? " · no classes" : ""}</Td>
              <Td className="text-right whitespace-nowrap">
                {manage && (
                  <>
                    <FormDialog title="Calendar event" fields={eventFields} columns={2} action={saveSetupAction.bind(null, "calendarEvent")} id={e.id} initial={{ title: e.title, kind: e.kind, termId: e.termId, startDate: d(e.startDate), endDate: d(e.endDate), isHoliday: e.isHoliday, description: e.description }} />
                    <DeleteEventButton id={e.id} title={e.title} />
                  </>
                )}
              </Td>
            </tr>
          ))}
        </DataTable>
        {events.length === 0 && <p className="px-5 py-4 text-sm text-muted-foreground">No calendar events.</p>}
      </Section>
    </div>
  );
}
