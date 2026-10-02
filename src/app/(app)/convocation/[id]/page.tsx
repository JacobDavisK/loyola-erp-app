import { notFound } from "next/navigation";
import { UserPlus } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section, StatCard } from "@/components/app/page";
import { ActionButton } from "@/features/academic-ops/controls";
import { addGraduatesAction, markHandoverAction, setConvocationStatusAction } from "@/features/campuslife/actions";
import { fmtDateTimeZoned } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { getInstitution } from "@/server/services/directory";

export const metadata: Metadata = { title: "Convocation" };

const NEXT = { PLANNED: ["REGISTRATION_OPEN", "Open registration"], REGISTRATION_OPEN: ["REGISTRATION_CLOSED", "Close registration and allot seats"], REGISTRATION_CLOSED: ["HELD", "Mark as held"] } as const;

export default async function ConvocationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageAuth("convocation.manage");
  const c = await db.convocation.findUnique({ where: { id }, include: { graduates: { include: { student: { select: { studentNo: true, firstName: true, lastName: true, program: { select: { code: true } } } } }, orderBy: [{ seatNo: "asc" }, { student: { studentNo: "asc" } }] } } });
  if (!c) notFound();
  const { timezone: tz } = await getInstitution();
  const g = c.graduates;
  const next = c.status === "HELD" ? null : NEXT[c.status];
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Convocation", href: "/convocation" }, { label: c.title }]}
        title={c.title}
        description={`${fmtDateTimeZoned(c.heldOn, tz)} · ${c.venue} · registration closes ${fmtDateTimeZoned(c.registrationCloses, tz)} · ${c.status.toLowerCase().replace(/_/g, " ")}`}
        actions={
          <>
            {c.status !== "HELD" && <ActionButton label="Add eligible graduates" icon={<UserPlus />} run={addGraduatesAction.bind(null, id)} />}
            {next && <ActionButton label={next[1]} variant="default" confirmText={`${next[1]}?`} run={setConvocationStatusAction.bind(null, id, next[0])} />}
          </>
        }
      />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
        <StatCard label="Invited" value={g.length} />
        <StatCard label="Attending" value={g.filter((x) => x.attendance === "IN_PERSON").length} />
        <StatCard label="In absentia" value={g.filter((x) => x.attendance === "IN_ABSENTIA").length} />
        <StatCard label="Not registered" value={g.filter((x) => !x.attendance).length} />
        <StatCard label="Guests" value={g.reduce((a, x) => a + x.guests, 0)} />
      </div>
      <Section title="Graduates" bodyClassName="p-0">
        <DataTable head={[{ label: "Seat" }, { label: "Graduate" }, { label: "Attendance" }, { label: "Guests" }, { label: "Gown" }, { label: "Degree" }]} empty="No graduates yet. Add the eligible graduates.">
          {g.map((x) => (
            <tr key={x.id}>
              <Td className="font-mono text-xs">{x.seatNo ?? "—"}</Td>
              <Td>{x.student.firstName} {x.student.lastName} <span className="font-mono text-xs text-muted-foreground">{x.student.studentNo} · {x.student.program.code}</span></Td>
              <Td className="text-xs">{x.attendance === "IN_PERSON" ? "In person" : x.attendance === "IN_ABSENTIA" ? "In absentia" : "—"}</Td>
              <Td>{x.guests}</Td>
              <Td><ActionButton size="xs" variant={x.gownIssuedAt ? "default" : "outline"} label={x.gownIssuedAt ? "Issued" : "Issue"} run={markHandoverAction.bind(null, x.id, "gown")} /></Td>
              <Td><ActionButton size="xs" variant={x.degreeHandedAt ? "default" : "outline"} label={x.degreeHandedAt ? "Handed" : "Hand over"} run={markHandoverAction.bind(null, x.id, "degree")} /></Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
