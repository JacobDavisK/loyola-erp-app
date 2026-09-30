import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { EmptyState, PageHeader, Section } from "@/components/app/page";
import { fmtDate } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "My examination duties" };

export default async function DutiesPage() {
  const ctx = await requirePageAuth("exam.duty");
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const [duties, valuations] = await Promise.all([
    db.invigilationDuty.findMany({ where: { userId: ctx.user.id, date: { gte: new Date(today.getTime() - 30 * 86_400_000) } }, include: { room: { select: { code: true, name: true } }, session: { select: { id: true, name: true } } }, orderBy: [{ date: "asc" }, { slot: "asc" }] }),
    can(ctx, "valuation.perform") ? db.scriptValuation.count({ where: { valuerId: ctx.user.id, submittedAt: null } }) : 0,
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="My examination duties" description="Invigilation assignments and valuation work." />
      {valuations > 0 && <Link href="/valuation" className="block rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm hover:bg-primary/10"><b>{valuations}</b> answer script(s) waiting for your valuation →</Link>}
      <Section title="Invigilation" bodyClassName="p-0">
        {duties.length === 0 ? <div className="p-6"><EmptyState icon={ShieldCheck} title="No duties assigned" /></div> : (
          <DataTable head={[{ label: "Date" }, { label: "Session" }, { label: "Room" }, { label: "Role" }, { label: "" }]}>
            {duties.map((d) => (
              <tr key={d.id} className={d.date < today ? "opacity-60" : undefined}>
                <Td className="text-sm whitespace-nowrap">{fmtDate(d.date)} · {d.slot === "FN" ? "Forenoon" : "Afternoon"}</Td>
                <Td className="text-xs">{d.session.name}</Td>
                <Td className="text-xs">{d.room.code} — {d.room.name}</Td>
                <Td className="text-xs">{d.role.replace("_", " ").toLowerCase()}</Td>
                <Td className="text-right"><Link className="text-xs text-primary hover:underline" href={`/exam-ops/seating?session=${d.sessionId}&date=${d.date.toISOString().slice(0, 10)}&slot=${d.slot}`}>Seating plan</Link></Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
    </div>
  );
}
