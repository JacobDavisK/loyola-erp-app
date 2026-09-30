import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { ScriptAttendanceButton } from "@/features/results/ops-panels";
import { SCRIPT_STATUS } from "@/lib/domain/labels";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Answer scripts" };

/**
 * Script register for one paper (valuation office only). Shows hall ticket ↔ dummy number so absence can be
 * recorded; valuers never see this page.
 */
export default async function ScriptsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageAuth("valuation.manage");
  const exam = await db.examination.findUnique({ where: { id }, include: { course: { select: { code: true, title: true } }, session: { select: { id: true, name: true } } } });
  if (!exam) notFound();
  const scripts = await db.answerScript.findMany({
    where: { examinationId: id },
    include: { registration: { select: { hallTicketNo: true, dummyNo: true } }, valuations: { orderBy: { round: "asc" }, include: { valuer: { select: { name: true } } } } },
    orderBy: { registration: { dummyNo: "asc" } },
  });
  return (
    <div>
      <PageHeader title={`${exam.course.code} — answer scripts`} description={`${exam.course.title} · ${exam.session.name} · maximum ${exam.maxMarks} marks`} breadcrumbs={[{ label: "Examination operations", href: `/exam-ops?session=${exam.session.id}&tab=scripts` }, { label: exam.course.code }]} />
      <Section bodyClassName="p-0">
        <DataTable head={[{ label: "Dummy no." }, { label: "Hall ticket" }, { label: "Valuations" }, { label: "Final", className: "text-right" }, { label: "Status" }, { label: "" }]}>
          {scripts.map((s) => (
            <tr key={s.id}>
              <Td className="font-mono text-xs">{s.registration.dummyNo}</Td>
              <Td className="font-mono text-xs">{s.registration.hallTicketNo}</Td>
              <Td className="text-xs">{s.absent ? "—" : s.valuations.map((v) => `R${v.round >= 10 ? "V" : v.round}: ${v.marks ?? "…"} (${v.valuer.name.split(" ").slice(-1)[0]})`).join(" · ") || "—"}</Td>
              <Td className="text-right tabular">{s.absent ? "AB" : s.finalMarks ?? "—"}</Td>
              <Td>{s.absent ? <span className="text-xs text-muted-foreground">Absent</span> : <StatusBadge meta={SCRIPT_STATUS[s.status]} />}</Td>
              <Td className="text-right">{!s.valuations.some((v) => v.submittedAt) && <ScriptAttendanceButton scriptId={s.id} absent={s.absent} />}</Td>
            </tr>
          ))}
        </DataTable>
        {scripts.length === 0 && <p className="px-5 py-4 text-sm text-muted-foreground">Scripts have not been coded yet.</p>}
      </Section>
    </div>
  );
}
