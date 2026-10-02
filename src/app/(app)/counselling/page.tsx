import { CalendarPlus, HeartHandshake } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { EmptyState, PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/features/academic-ops/controls";
import { addSlotsAction, cancelSlotAction, recordSessionAction } from "@/features/campuslife/actions";
import { fmtDate, fmtDateTimeZoned } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { counsellingDesk } from "@/server/services/counselling";
import { getInstitution } from "@/server/services/directory";

export const metadata: Metadata = { title: "Counselling desk" };

const MODE = { IN_PERSON: "In person", ONLINE: "Online", PHONE: "Phone" } as const;

export default async function CounsellingDeskPage() {
  const ctx = await requirePageAuth(["counselling.provide", "counselling.manage"]);
  const [slots, { timezone: tz }] = await Promise.all([counsellingDesk(ctx), getInstitution()]);
  const now = new Date();
  const upcoming = slots.filter((s) => s.endsAt >= now);
  const past = slots.filter((s) => s.endsAt < now && s.booking);
  const crises = past.filter((s) => s.booking?.crisis);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Counselling desk"
        description="Publish times students can book. Notes are confidential to the counselling service; mark a session as a crisis to alert the head of counselling at once."
        actions={can(ctx, "counselling.provide") ? (
          <FormDialog title="Counselling slots" action={addSlotsAction} submitLabel="Publish" columns={2} initial={{ from: "10:00", count: 4, minutes: 45, mode: "IN_PERSON" }} trigger={<Button size="sm"><CalendarPlus /> Add slots</Button>}
            fields={[
              { name: "date", label: "Date", type: "date" }, { name: "from", label: "First slot starts", type: "time" },
              { name: "count", label: "Number of slots", type: "number", min: 1, max: 12 }, { name: "minutes", label: "Minutes each", type: "number", min: 15, max: 120 },
              { name: "mode", label: "Mode", type: "select", options: Object.entries(MODE).map(([value, label]) => ({ value, label })) }, { name: "location", label: "Room / link", type: "text", optional: true },
            ]} />
        ) : undefined}
      />
      {crises.length > 0 && can(ctx, "counselling.manage") && <p role="alert" className="rounded-lg border border-tone-danger/40 bg-tone-danger/5 px-4 py-3 text-sm">{crises.length} session(s) in the last 30 days were marked as a crisis. Make sure each has a follow-up.</p>}
      <Section title="Upcoming" bodyClassName="p-0">
        <DataTable head={[{ label: "When" }, { label: "Counsellor" }, { label: "Mode" }, { label: "Student" }, { label: "" }]} empty="No upcoming slots.">
          {upcoming.map((s) => (
            <tr key={s.id} className={s.status === "CANCELLED" ? "opacity-50" : undefined}>
              <Td className="text-sm">{fmtDateTimeZoned(s.startsAt, tz)}</Td>
              <Td className="text-xs">{s.counsellor.name}</Td>
              <Td className="text-xs">{MODE[s.mode]}{s.location ? ` · ${s.location}` : ""}</Td>
              <Td>{s.booking && s.booking.status === "BOOKED" ? <><div className="text-sm">{s.booking.student.firstName} {s.booking.student.lastName} <span className="font-mono text-xs text-muted-foreground">{s.booking.student.studentNo}</span></div>{s.booking.reason && <div className="text-xs text-muted-foreground">“{s.booking.reason}”</div>}</> : <span className="text-xs text-muted-foreground">{s.status === "CANCELLED" ? "cancelled" : "open"}</span>}</Td>
              <Td className="text-right whitespace-nowrap">
                {s.booking && s.booking.status === "BOOKED" && s.startsAt <= now && <FormDialog title="Session record" action={recordSessionAction.bind(null, s.booking.id)} submitLabel="Save" trigger={<Button size="xs" variant="outline">Record</Button>} initial={{ status: "ATTENDED", crisis: false }} fields={[{ name: "status", label: "Outcome", type: "select", options: [{ value: "ATTENDED", label: "Attended" }, { value: "NO_SHOW", label: "Did not come" }] }, { name: "notes", label: "Confidential notes", type: "textarea", optional: true }, { name: "followUpOn", label: "Follow up on", type: "date", optional: true }, { name: "crisis", label: "Crisis — alert the head of counselling", type: "checkbox" }]} />}
                {s.status !== "CANCELLED" && s.startsAt > now && <ActionButton size="xs" variant="ghost" label="Cancel" confirmText={s.booking ? "Cancel this booked session? The student is told to book again." : "Cancel this slot?"} run={cancelSlotAction.bind(null, s.id)} />}
              </Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      {past.length > 0 ? (
        <Section title="Recent sessions (30 days)" bodyClassName="p-0">
          <DataTable head={[{ label: "When" }, { label: "Student" }, { label: "Outcome" }, { label: "Notes" }, { label: "" }]}>
            {past.map((s) => (
              <tr key={s.id} className="align-top">
                <Td className="text-xs">{fmtDateTimeZoned(s.startsAt, tz)}</Td>
                <Td className="text-sm">{s.booking!.student.firstName} {s.booking!.student.lastName}</Td>
                <Td className={s.booking!.crisis ? "text-xs font-semibold text-tone-danger" : "text-xs"}>{s.booking!.status.toLowerCase().replace("_", " ")}{s.booking!.crisis ? " · crisis" : ""}{s.booking!.followUpOn ? ` · follow up ${fmtDate(s.booking!.followUpOn)}` : ""}</Td>
                <Td className="max-w-md text-xs whitespace-pre-wrap">{s.booking!.notes ?? "—"}</Td>
                <Td className="text-right"><FormDialog title="Session record" id={s.booking!.id} action={recordSessionAction.bind(null, s.booking!.id)} submitLabel="Save" initial={{ status: s.booking!.status === "NO_SHOW" ? "NO_SHOW" : "ATTENDED", notes: s.booking!.notes, crisis: s.booking!.crisis, followUpOn: s.booking!.followUpOn?.toISOString().slice(0, 10) ?? null }} fields={[{ name: "status", label: "Outcome", type: "select", options: [{ value: "ATTENDED", label: "Attended" }, { value: "NO_SHOW", label: "Did not come" }] }, { name: "notes", label: "Confidential notes", type: "textarea", optional: true }, { name: "followUpOn", label: "Follow up on", type: "date", optional: true }, { name: "crisis", label: "Crisis — alert the head of counselling", type: "checkbox" }]} /></Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      ) : upcoming.length === 0 ? <EmptyState icon={HeartHandshake} title="No sessions yet" description="Add slots so students can book." /> : null}
    </div>
  );
}
