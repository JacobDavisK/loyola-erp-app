import Link from "next/link";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/features/academic-ops/controls";
import { cancelBookingAction, requestBookingAction } from "@/features/operations/actions";
import { DecideBooking } from "@/features/operations/controls";
import { bookingFields } from "@/features/operations/fields";
import { fmtDateTimeZoned } from "@/lib/format";
import { cn } from "@/lib/utils";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { getInstitution } from "@/server/services/directory";
import { freeRooms, roomBusy, utilisation } from "@/server/services/facilities";
import { getSetting } from "@/server/services/settings";

export const metadata: Metadata = { title: "Room booking" };

export default async function FacilitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageAuth();
  if (ctx.user.userType !== "STAFF") return null;
  const sp = await searchParams;
  const { timezone } = await getInstitution();
  const manage = can(ctx, "facility.manage");
  const ops = await getSetting("operations");
  const now = new Date();
  const rooms = await db.room.findMany({ where: { isActive: true }, orderBy: { code: "asc" } });
  const [mine, pending] = await Promise.all([
    db.facilityBooking.findMany({ where: { bookedById: ctx.user.id, endsAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } }, include: { room: true }, orderBy: { startsAt: "asc" } }),
    manage ? db.facilityBooking.findMany({ where: { status: "REQUESTED", endsAt: { gte: now } }, include: { room: true }, orderBy: { startsAt: "asc" } }) : [],
  ]);
  const requesters = new Map((await db.user.findMany({ where: { id: { in: pending.map((p) => p.bookedById) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  // Free-room finder: a window on a day.
  const day = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : null;
  const from = sp.from ?? "10:00";
  const to = sp.to ?? "12:00";
  const { zonedTimeToUtc } = await import("@/lib/domain/timetable");
  const win = day ? { start: zonedTimeToUtc(day, from, timezone), end: zonedTimeToUtc(day, to, timezone) } : null;
  const free = win && win.end > win.start ? await freeRooms(win.start, win.end, Number(sp.seats ?? 0) || 0) : null;
  const roomId = sp.room;
  const schedule = roomId ? await roomBusy(roomId, now, new Date(now.getTime() + 7 * 86_400_000)) : null;
  const usage = manage ? await utilisation(new Date(now.getTime() - 28 * 86_400_000), now) : null;
  const fields = bookingFields(rooms.map((r) => ({ id: r.id, label: `${r.code} — ${r.name} (${r.capacity} seats${ops.approvalRoomTypes.includes(r.type) ? ", needs approval" : ""})` })));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Room booking"
        description="Book a classroom, lab, seminar hall or auditorium for a meeting or event. The room is checked against the class timetable and other bookings. Classrooms are confirmed at once; halls are confirmed by the estate office."
        actions={<FormDialog title="Booking" action={requestBookingAction} fields={fields} columns={2} submitLabel="Book" trigger={<Button size="sm"><Plus /> Book a room</Button>} />}
      />
      {pending.length > 0 && (
        <Section title="Waiting for approval" bodyClassName="p-0">
          <DataTable head={[{ label: "Room" }, { label: "Event" }, { label: "When" }, { label: "Requested by" }, { label: "" }]}>
            {pending.map((b) => (
              <tr key={b.id}>
                <Td className="font-mono text-xs">{b.room.code}</Td>
                <Td>{b.title}{b.attendees ? <span className="text-xs text-muted-foreground"> · {b.attendees} people</span> : null}{b.purpose && <div className="text-[11px] text-muted-foreground">{b.purpose}</div>}</Td>
                <Td className="text-xs">{fmtDateTimeZoned(b.startsAt, timezone)} – {fmtDateTimeZoned(b.endsAt, timezone).slice(-5)}</Td>
                <Td className="text-xs">{requesters.get(b.bookedById)}</Td>
                <Td className="text-right"><DecideBooking id={b.id} /></Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
      <Section title="My bookings" bodyClassName="p-0">
        <DataTable head={[{ label: "Room" }, { label: "Event" }, { label: "When" }, { label: "Status" }, { label: "" }]} empty="No bookings.">
          {mine.map((b) => (
            <tr key={b.id} className={["CANCELLED", "REJECTED"].includes(b.status) ? "opacity-60" : undefined}>
              <Td className="font-mono text-xs">{b.room.code}</Td>
              <Td>{b.title}{b.decisionNote && b.status === "REJECTED" && <div className="text-[11px] text-tone-danger">{b.decisionNote}</div>}</Td>
              <Td className="text-xs">{fmtDateTimeZoned(b.startsAt, timezone)} – {fmtDateTimeZoned(b.endsAt, timezone).slice(-5)}</Td>
              <Td className="text-xs">{b.status === "REQUESTED" ? "awaiting approval" : b.status.toLowerCase()}</Td>
              <Td className="text-right">{["REQUESTED", "APPROVED"].includes(b.status) && b.endsAt > now && <ActionButton label="Cancel" variant="ghost" size="xs" run={cancelBookingAction.bind(null, b.id)} confirmText="Cancel this booking?" />}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      <Section title="Find a free room">
        <form className="flex flex-wrap items-end gap-2 text-sm" action="/facilities">
          <label className="space-y-1"><span className="block text-xs text-muted-foreground">Day</span><input name="day" type="date" defaultValue={day ?? now.toISOString().slice(0, 10)} className="h-9 rounded-lg border bg-card px-2" /></label>
          <label className="space-y-1"><span className="block text-xs text-muted-foreground">From</span><input name="from" type="time" defaultValue={from} className="h-9 rounded-lg border bg-card px-2" /></label>
          <label className="space-y-1"><span className="block text-xs text-muted-foreground">To</span><input name="to" type="time" defaultValue={to} className="h-9 rounded-lg border bg-card px-2" /></label>
          <label className="space-y-1"><span className="block text-xs text-muted-foreground">Seats</span><input name="seats" type="number" min={0} defaultValue={sp.seats ?? ""} className="h-9 w-24 rounded-lg border bg-card px-2" /></label>
          <Button size="sm" type="submit" variant="outline">Search</Button>
        </form>
        {free && (
          <p className="mt-3 text-sm">{free.length ? <>Free: {free.map((r, i) => <span key={r.id}>{i > 0 && ", "}<Link className="font-mono text-primary hover:underline" href={`/facilities?room=${r.id}`}>{r.code}</Link> <span className="text-xs text-muted-foreground">({r.capacity})</span></span>)}</> : "No room is free then."}</p>
        )}
        <div className="mt-4 flex flex-wrap gap-1 text-xs">
          {rooms.map((r) => <Link key={r.id} href={`/facilities?room=${r.id}`} className={cn("rounded border px-1.5 py-0.5 font-mono", roomId === r.id ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>{r.code}</Link>)}
        </div>
        {schedule && (
          <div className="mt-3 text-sm">
            <div className="mb-1 font-medium">{rooms.find((r) => r.id === roomId)?.name}: next 7 days</div>
            {schedule.length ? <ul className="space-y-0.5 text-xs">{schedule.map((b, i) => <li key={i}>{fmtDateTimeZoned(b.startsAt, timezone)} – {fmtDateTimeZoned(b.endsAt, timezone).slice(-5)} · {b.label}</li>)}</ul> : <p className="text-xs text-muted-foreground">Nothing booked.</p>}
          </div>
        )}
      </Section>
      {usage && (
        <Section title="Utilisation, last 4 weeks" description="Hours occupied by classes and bookings against eight hours a working day." bodyClassName="p-0">
          <DataTable head={[{ label: "Room" }, { label: "Type" }, { label: "Hours", className: "text-right" }, { label: "Use", className: "text-right" }]}>
            {usage.map((u) => (
              <tr key={u.room.id}>
                <Td className="font-mono text-xs">{u.room.code} <span className="font-sans text-muted-foreground">{u.room.name}</span></Td>
                <Td className="text-xs">{u.room.type.toLowerCase().replace("_", " ")}</Td>
                <Td className="text-right tabular">{u.hours}</Td>
                <Td className="text-right tabular">{u.percent}%</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
    </div>
  );
}
