import { PenLine } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { EmptyState, PageHeader, Section } from "@/components/app/page";
import { ValuationEntry } from "@/features/results/valuation-row";
import { fmtDateTime } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { myValuations } from "@/server/services/valuation";

export const metadata: Metadata = { title: "Valuation" };

export default async function ValuationPage() {
  const ctx = await requirePageAuth("valuation.perform");
  const rows = await myValuations(ctx);
  const pending = rows.filter((r) => !r.submittedAt);
  const done = rows.filter((r) => r.submittedAt).slice(0, 50);
  const label = (round: number) => (round >= 10 ? "Revaluation" : round === 1 ? "First valuation" : round === 2 ? "Second valuation" : "Third valuation");
  return (
    <div className="space-y-6">
      <PageHeader title="Valuation" description="Scripts assigned to you, identified only by dummy number. Enter the total out of the paper's maximum (half marks allowed)." />
      <Section title={`To value (${pending.length})`} bodyClassName="p-0">
        {pending.length === 0 ? <div className="p-6"><EmptyState icon={PenLine} title="No scripts waiting" description="Scripts appear here when the valuation office assigns them to you." /></div> : (
          <DataTable head={[{ label: "Dummy no." }, { label: "Paper" }, { label: "Round" }, { label: "Assigned" }, { label: "Marks", className: "text-right" }]}>
            {pending.map((r) => (
              <tr key={r.id}>
                <Td className="font-mono text-sm font-medium">{r.script.registration.dummyNo}</Td>
                <Td><span className="font-mono text-xs text-muted-foreground">{r.script.examination.course.code}</span> {r.script.examination.course.title}<div className="text-[11px] text-muted-foreground">{r.script.examination.session.name}</div></Td>
                <Td className="text-xs">{label(r.round)}</Td>
                <Td className="text-xs whitespace-nowrap">{fmtDateTime(r.assignedAt)}</Td>
                <Td><ValuationEntry valuationId={r.id} max={r.script.examination.maxMarks} revaluation={r.round >= 10} /></Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
      {done.length > 0 && (
        <Section title="Submitted" bodyClassName="p-0">
          <DataTable head={[{ label: "Dummy no." }, { label: "Paper" }, { label: "Round" }, { label: "Marks", className: "text-right" }, { label: "Submitted" }]}>
            {done.map((r) => (
              <tr key={r.id}>
                <Td className="font-mono text-xs">{r.script.registration.dummyNo}</Td>
                <Td className="text-xs">{r.script.examination.course.code}</Td>
                <Td className="text-xs">{label(r.round)}</Td>
                <Td className="text-right tabular">{r.marks} / {r.script.examination.maxMarks}</Td>
                <Td className="text-xs whitespace-nowrap">{fmtDateTime(r.submittedAt)}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
    </div>
  );
}
