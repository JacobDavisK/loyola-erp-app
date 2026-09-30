import Link from "next/link";
import { RefreshCcw } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, LinkTabs, Td } from "@/components/app/list";
import { EmptyState, PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { RevalControls } from "@/features/results/reval-controls";
import { REVAL_STATUS } from "@/lib/domain/labels";
import { fmtDateTime } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { usersWithPermission } from "@/server/services/directory";

export const metadata: Metadata = { title: "Revaluation desk" };

export default async function RevaluationDeskPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requirePageAuth("revaluation.manage");
  const { view = "open" } = await searchParams;
  const open = view === "open";
  const [rows, valuerIds] = await Promise.all([
    db.revaluationRequest.findMany({
      where: open ? { status: { in: ["FEE_PENDING", "REQUESTED", "IN_PROGRESS"] } } : { status: { in: ["COMPLETED", "REJECTED", "CANCELLED"] } },
      orderBy: { requestedAt: open ? "asc" : "desc" },
      take: 200,
      include: { student: { select: { id: true, studentNo: true, firstName: true, lastName: true } }, courseResult: { select: { grade: true, course: { select: { code: true } }, run: { select: { session: { select: { code: true } } } } } } },
    }),
    usersWithPermission("valuation.perform"),
  ]);
  const valuers = await db.user.findMany({ where: { id: { in: valuerIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return (
    <div className="space-y-6">
      <PageHeader title="Revaluation desk" description="Retotalling and revaluation requests. Revaluation is done anonymously by a valuer who has not seen the script; the result changes only under the configured rule, as a new version." breadcrumbs={[{ label: "Results", href: "/results" }, { label: "Revaluation" }]} />
      <LinkTabs active={view} tabs={[{ key: "open", label: "Open", href: "/results/revaluation" }, { key: "closed", label: "Closed", href: "/results/revaluation?view=closed" }]} />
      <Section bodyClassName="p-0">
        {rows.length === 0 ? <div className="p-6"><EmptyState icon={RefreshCcw} title={open ? "No open requests" : "No closed requests"} /></div> : (
          <DataTable head={[{ label: "Student" }, { label: "Paper" }, { label: "Type" }, { label: "Marks" }, { label: "Status" }, { label: "Requested" }, { label: "" }]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td><Link href={`/students/${r.student.id}?tab=results`} className="hover:text-primary">{r.student.firstName} {r.student.lastName}</Link><div className="font-mono text-[11px] text-muted-foreground">{r.student.studentNo}</div></Td>
                <Td className="text-xs">{r.courseResult.course.code} · {r.courseResult.run.session.code}<div className="text-muted-foreground">grade {r.courseResult.grade}</div></Td>
                <Td className="text-xs">{r.type === "REVALUATION" ? "Revaluation" : "Retotalling"}{r.fee ? ` · fee ${r.fee}` : ""}</Td>
                <Td className="text-xs tabular">{r.originalMarks ?? "—"}{r.revisedMarks !== null ? ` → ${r.revisedMarks}` : ""}{r.outcome ? <div className="text-muted-foreground">{r.outcome.toLowerCase()}</div> : null}</Td>
                <Td><StatusBadge meta={REVAL_STATUS[r.status]} />{r.remarks && <div className="text-[11px] text-muted-foreground">{r.remarks}</div>}</Td>
                <Td className="text-xs whitespace-nowrap">{fmtDateTime(r.requestedAt)}</Td>
                <Td className="min-w-56"><RevalControls id={r.id} status={r.status} type={r.type} valuers={valuers} /></Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
    </div>
  );
}
