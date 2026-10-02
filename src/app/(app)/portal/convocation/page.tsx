import { redirect } from "next/navigation";
import { GraduationCap } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { EmptyState, KeyValue, PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { registerConvocationAction } from "@/features/campuslife/actions";
import { fmtDateTimeZoned } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { getInstitution } from "@/server/services/directory";

export const metadata: Metadata = { title: "Convocation" };

export default async function MyConvocationPage() {
  const ctx = await requirePageAuth("self.portal");
  if (!ctx.subject.studentId) redirect("/portal");
  const [invites, { timezone: tz }] = await Promise.all([db.convocationGraduate.findMany({ where: { studentId: ctx.subject.studentId }, include: { convocation: true }, orderBy: { convocation: { heldOn: "desc" } } }), getInstitution()]);
  if (!invites.length) return <EmptyState icon={GraduationCap} title="No convocation invitation" description="Graduates are invited once their degree certificate is issued and no fees are outstanding." />;
  return (
    <div className="space-y-6">
      <PageHeader title="Convocation" breadcrumbs={[{ label: "My studies" }, { label: "Convocation" }]} />
      {invites.map((g) => {
        const c = g.convocation;
        const open = c.status === "REGISTRATION_OPEN" && c.registrationCloses > new Date();
        return (
          <Section key={g.id} title={c.title}
            actions={open ? <FormDialog title="Convocation registration" action={registerConvocationAction.bind(null, c.id)} submitLabel="Save" id={g.id} initial={{ attendance: g.attendance ?? "IN_PERSON", guests: g.guests }} trigger={<Button size="sm">{g.attendance ? "Change registration" : "Register"}</Button>}
              fields={[{ name: "attendance", label: "I will", type: "select", options: [{ value: "IN_PERSON", label: "Attend in person" }, { value: "IN_ABSENTIA", label: "Receive my degree in absentia" }] }, { name: "guests", label: `Guests (up to ${c.maxGuests})`, type: "number", min: 0, max: c.maxGuests }]} /> : undefined}>
            <KeyValue items={[
              ["When", fmtDateTimeZoned(c.heldOn, tz)], ["Where", c.venue], ["Registration closes", fmtDateTimeZoned(c.registrationCloses, tz)],
              ["Your choice", g.attendance === "IN_PERSON" ? `Attending with ${g.guests} guest(s)` : g.attendance === "IN_ABSENTIA" ? "In absentia" : "Not registered yet"],
              ...(g.seatNo ? ([["Seat", g.seatNo]] as [string, string][]) : []),
              ...(g.degreeHandedAt ? ([["Degree", "Handed over"]] as [string, string][]) : []),
            ]} />
          </Section>
        );
      })}
    </div>
  );
}
