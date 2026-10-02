import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { ActionButton } from "@/features/academic-ops/controls";
import { cancelBookingAction } from "@/features/campuslife/actions";
import { BookSlot } from "@/features/campuslife/controls";
import { fmtDateTimeZoned } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { openSlots } from "@/server/services/counselling";
import { getInstitution } from "@/server/services/directory";

export const metadata: Metadata = { title: "Counselling" };

const MODE = { IN_PERSON: "In person", ONLINE: "Online", PHONE: "Phone" } as const;

export default async function MyCounsellingPage() {
  const ctx = await requirePageAuth("self.portal");
  const studentId = ctx.subject.studentId;
  if (!studentId) redirect("/portal");
  const now = new Date();
  const [slots, mine, { timezone: tz }] = await Promise.all([
    openSlots(),
    db.counsellingBooking.findMany({ where: { studentId, slot: { startsAt: { gte: new Date(now.getTime() - 60 * 86_400_000) } } }, include: { slot: { include: { counsellor: { select: { name: true } } } } }, orderBy: { slot: { startsAt: "desc" } } }),
    getInstitution(),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Counselling"
        breadcrumbs={[{ label: "My studies" }, { label: "Counselling" }]}
        description="Talk to a trained counsellor about stress, studies, relationships or anything that worries you. Booking is private: your teachers, mentor and family are not told. If you are in danger right now, call the national helpline Tele-MANAS on 14416."
      />
      {mine.length > 0 && (
        <Section title="My sessions" bodyClassName="p-0">
          <DataTable head={[{ label: "When" }, { label: "Counsellor" }, { label: "Mode" }, { label: "Status" }, { label: "" }]}>
            {mine.map((b) => (
              <tr key={b.id}>
                <Td className="text-sm">{fmtDateTimeZoned(b.slot.startsAt, tz)}</Td>
                <Td className="text-xs">{b.slot.counsellor.name}</Td>
                <Td className="text-xs">{MODE[b.slot.mode]}{b.slot.location ? ` · ${b.slot.location}` : ""}</Td>
                <Td className="text-xs">{b.status.toLowerCase().replace("_", " ")}</Td>
                <Td className="text-right">{b.status === "BOOKED" && b.slot.startsAt > now && <ActionButton size="xs" variant="ghost" label="Cancel" confirmText="Cancel this session?" run={cancelBookingAction.bind(null, b.id)} />}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
      <Section title="Available times" bodyClassName="p-0">
        <DataTable head={[{ label: "When" }, { label: "Counsellor" }, { label: "Mode" }, { label: "" }]} empty="No times are open in the next three weeks. Ask at the student welfare office.">
          {slots.map((s) => (
            <tr key={s.id} className="align-top">
              <Td className="text-sm">{fmtDateTimeZoned(s.startsAt, tz)}</Td>
              <Td className="text-xs">{s.counsellor.name}</Td>
              <Td className="text-xs">{MODE[s.mode]}{s.location ? ` · ${s.location}` : ""}</Td>
              <Td className="text-right"><BookSlot slotId={s.id} /></Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
