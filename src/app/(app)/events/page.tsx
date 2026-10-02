import Link from "next/link";
import { CalendarPlus, Plus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, LinkTabs, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/features/academic-ops/controls";
import { addMembersAction, joinClubAction, leaveClubAction, saveClubAction, saveEventAction } from "@/features/campuslife/actions";
import { clubFields, eventFields } from "@/features/campuslife/fields";
import { fmtDateTimeZoned } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { getInstitution } from "@/server/services/directory";

export const metadata: Metadata = { title: "Events & clubs" };

const KIND: Record<string, string> = { CLUB: "Club", NSS: "NSS", NCC: "NCC", SPORTS: "Sports", CULTURAL: "Cultural", PROFESSIONAL: "Professional society" };

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePageAuth();
  const { tab = "events" } = await searchParams;
  const manage = can(ctx, "events.manage");
  const now = new Date();
  const [events, clubs, myRegs, myClubs, badges, staff, { timezone: tz }] = await Promise.all([
    db.campusEvent.findMany({ where: manage ? {} : { OR: [{ status: "PUBLISHED" }, { createdById: ctx.user.id }, { club: { coordinatorId: ctx.user.id } }] }, orderBy: { startsAt: "asc" }, include: { club: { select: { name: true } }, _count: { select: { registrations: { where: { cancelledAt: null } } } } }, take: 200 }),
    db.club.findMany({ where: manage ? {} : { active: true }, orderBy: { name: "asc" }, include: { coordinator: { select: { name: true } }, _count: { select: { members: { where: { leftAt: null } } } } } }),
    db.eventRegistration.findMany({ where: { userId: ctx.user.id, cancelledAt: null }, select: { eventId: true, attendedAt: true } }),
    ctx.subject.studentId ? db.clubMember.findMany({ where: { studentId: ctx.subject.studentId, leftAt: null }, select: { clubId: true, hours: true } }) : [],
    db.badgeClass.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    manage ? db.user.findMany({ where: { userType: "STAFF", status: "ACTIVE", deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
    getInstitution(),
  ]);
  const coordinated = clubs.filter((c) => c.coordinatorId === ctx.user.id);
  const canCreate = manage || coordinated.length > 0;
  const reg = new Map(myRegs.map((r) => [r.eventId, r]));
  const member = new Map(myClubs.map((m) => [m.clubId, m]));
  const upcoming = events.filter((e) => e.endsAt >= now && e.status !== "CANCELLED");
  const past = events.filter((e) => e.endsAt < now || e.status === "CANCELLED").reverse();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Events & clubs"
        description="Workshops, fests, sports, NSS and NCC activities. Register, scan the QR code at the venue to mark attendance, and collect activity hours and participation badges."
        actions={canCreate ? (
          <>
            {manage && <FormDialog title="Club" columns={2} fields={clubFields(staff)} action={saveClubAction} initial={{ kind: "CLUB", coordinatorId: staff[0]?.id ?? "", active: true }} trigger={<Button size="sm" variant="outline"><Plus /> Club</Button>} />}
            <FormDialog title="Event" columns={2} fields={eventFields(manage ? clubs : coordinated, badges)} action={saveEventAction} initial={{ status: "PUBLISHED", clubId: coordinated[0]?.id ?? null }} trigger={<Button size="sm"><CalendarPlus /> Event</Button>} />
          </>
        ) : undefined}
      />
      <LinkTabs tabs={[{ key: "events", label: "Events", href: "?tab=events" }, { key: "clubs", label: "Clubs", href: "?tab=clubs" }, { key: "past", label: "Past", href: "?tab=past" }]} active={tab} />
      {tab !== "clubs" && (
        <Section bodyClassName="p-0">
          <DataTable head={[{ label: "Event" }, { label: "When" }, { label: "Where" }, { label: "Registered" }, { label: "" }]} empty="No events.">
            {(tab === "past" ? past : upcoming).map((e) => (
              <tr key={e.id}>
                <Td><Link className="font-medium hover:text-primary" href={`/events/${e.id}`}>{e.title}</Link><div className="text-xs text-muted-foreground">{e.club?.name ?? "Institution"}{e.status !== "PUBLISHED" ? ` · ${e.status.toLowerCase()}` : ""}{e.hours ? ` · ${e.hours} h` : ""}</div></Td>
                <Td className="text-xs">{fmtDateTimeZoned(e.startsAt, tz)}</Td>
                <Td className="text-xs">{e.venue}</Td>
                <Td className="text-xs">{e._count.registrations}{e.capacity ? ` / ${e.capacity}` : ""}</Td>
                <Td className="text-xs">{reg.get(e.id)?.attendedAt ? <span className="text-tone-success">attended</span> : reg.has(e.id) ? "registered" : ""}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
      {tab === "clubs" && (
        <Section bodyClassName="p-0">
          <DataTable head={[{ label: "Club" }, { label: "Kind" }, { label: "Coordinator" }, { label: "Members" }, { label: "" }]} empty="No clubs yet.">
            {clubs.map((c) => (
              <tr key={c.id} className={c.active ? "align-top" : "align-top opacity-60"}>
                <Td><div className="font-medium">{c.name}</div><div className="max-w-md text-xs text-muted-foreground">{c.description}</div></Td>
                <Td className="text-xs">{KIND[c.kind]}</Td>
                <Td className="text-xs">{c.coordinator.name}</Td>
                <Td>{c._count.members}</Td>
                <Td className="whitespace-nowrap text-right">
                  {ctx.subject.studentId && c.active && (member.has(c.id)
                    ? <><span className="mr-2 text-xs text-muted-foreground">member · {member.get(c.id)!.hours} h</span><ActionButton size="xs" variant="ghost" label="Leave" confirmText={`Leave ${c.name}?`} run={leaveClubAction.bind(null, c.id)} /></>
                    : <ActionButton size="xs" label="Join" run={joinClubAction.bind(null, c.id)} />)}
                  {(manage || c.coordinatorId === ctx.user.id) && <FormDialog title="Members" action={addMembersAction.bind(null, c.id)} submitLabel="Add" trigger={<Button size="xs" variant="outline">Add members</Button>} fields={[{ name: "studentNos", label: "Student numbers", type: "textarea" }, { name: "role", label: "Role", type: "text", optional: true, placeholder: "MEMBER, SECRETARY…" }]} />}
                  {manage && <FormDialog title="Club" columns={2} id={c.id} fields={clubFields(staff)} action={saveClubAction} initial={{ name: c.name, kind: c.kind, coordinatorId: c.coordinatorId, description: c.description, active: c.active }} />}
                </Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
    </div>
  );
}
