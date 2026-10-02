import { notFound } from "next/navigation";
import { CheckCheck, X } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { ActionButton } from "@/features/academic-ops/controls";
import { cancelEventRegistrationAction, cancelEventAction, completeEventAction, registerEventAction, saveEventAction } from "@/features/campuslife/actions";
import { AttendanceList } from "@/features/campuslife/controls";
import { eventFields } from "@/features/campuslife/fields";
import { PromptButton } from "@/features/finance/controls";
import { fmtDateTimeZoned, toZonedInput } from "@/lib/format";
import { can, isSuperAdmin, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { eventQr } from "@/server/services/campus-events";
import { getInstitution } from "@/server/services/directory";

export const metadata: Metadata = { title: "Event" };

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth();
  const e = await db.campusEvent.findUnique({ where: { id }, include: { club: true, registrations: { where: { cancelledAt: null }, orderBy: { registeredAt: "asc" }, include: { user: { select: { name: true, employeeId: true, userType: true } } } } } });
  const manager = !!e && (e.createdById === ctx.user.id || e.club?.coordinatorId === ctx.user.id || can(ctx, "events.manage") || isSuperAdmin(ctx));
  if (!e || (e.status === "DRAFT" && !manager)) notFound();
  const { timezone: tz } = await getInstitution();
  const mine = e.registrations.find((r) => r.userId === ctx.user.id);
  const now = new Date();
  const open = e.status === "PUBLISHED" && now < e.endsAt && (!e.registrationCloses || now < e.registrationCloses);
  const qr = manager && e.status === "PUBLISHED" ? await eventQr(ctx, id) : null;
  const [clubs, badges] = manager ? await Promise.all([db.club.findMany({ where: can(ctx, "events.manage") ? {} : { coordinatorId: ctx.user.id }, select: { id: true, name: true } }), db.badgeClass.findMany({ where: { active: true }, select: { id: true, name: true } })]) : [[], []];
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Events", href: "/events" }, { label: e.title }]}
        title={e.title}
        description={`${e.club?.name ?? "Institution event"} · ${e.status.toLowerCase()}`}
        actions={
          <>
            {!mine && open && <ActionButton label="Register" variant="default" run={registerEventAction.bind(null, id)} />}
            {mine && !mine.attendedAt && e.status === "PUBLISHED" && <ActionButton label="Cancel registration" icon={<X />} run={cancelEventRegistrationAction.bind(null, id)} />}
            {manager && e.status !== "COMPLETED" && e.status !== "CANCELLED" && <FormDialog title="Event" columns={2} id={e.id} fields={eventFields(clubs, badges)} action={saveEventAction} initial={{ title: e.title, clubId: e.clubId, venue: e.venue, startsAt: toZonedInput(e.startsAt, tz), endsAt: toZonedInput(e.endsAt, tz), capacity: e.capacity, registrationCloses: toZonedInput(e.registrationCloses, tz), hours: e.hours, badgeId: e.badgeId, status: e.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT", description: e.description }} />}
            {manager && e.status === "PUBLISHED" && e.endsAt < now && <ActionButton label="Complete event" variant="default" icon={<CheckCheck />} confirmText="Complete the event? Hours are credited and badges awarded to everyone marked as attended." run={completeEventAction.bind(null, id)} />}
            {manager && e.status === "PUBLISHED" && e.endsAt > now && <PromptButton label="Cancel event" destructive question="Why is the event cancelled? Registered people are told." action={cancelEventAction.bind(null, id)} />}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="About" className="lg:col-span-2">
          <p className="whitespace-pre-wrap text-sm">{e.description}</p>
          <KeyValue className="mt-4" items={[["When", `${fmtDateTimeZoned(e.startsAt, tz)} – ${fmtDateTimeZoned(e.endsAt, tz)}`], ["Where", e.venue], ["Registered", `${e.registrations.length}${e.capacity ? ` of ${e.capacity}` : ""}`], ...(e.hours ? ([["Activity hours", String(e.hours)]] as [string, string][]) : []), ["You", mine ? (mine.attendedAt ? "Attended" : "Registered") : "Not registered"]]} />
        </Section>
        {qr && (
          <Section title="Attendance QR code" description="Show this at the venue during the event; people scan it to mark themselves present.">
            <div className="rounded-xl border bg-white p-3" dangerouslySetInnerHTML={{ __html: qr.svg }} />
          </Section>
        )}
      </div>
      {manager && e.registrations.length > 0 && (
        <Section title="Attendance">
          <AttendanceList eventId={id} rows={e.registrations.map((r) => ({ id: r.id, name: r.user.name, detail: `${r.user.userType === "STUDENT" ? r.user.employeeId : "staff"}${r.attendedAt ? " · present" : ""}`, attended: !!r.attendedAt }))} />
        </Section>
      )}
    </div>
  );
}
