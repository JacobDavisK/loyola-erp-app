import Link from "next/link";
import { ListChecks } from "lucide-react";
import type { Metadata } from "next";
import type { ScrutinyStatus } from "@/generated/prisma/enums";
import { DataTable, LinkTabs, Td } from "@/components/app/list";
import { Deadline } from "@/components/app/deadline";
import { EmptyState, PageHeader } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { PAPER_STATUS, SCRUTINY_STATUS } from "@/lib/domain/labels";
import { fmtRelative } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Scrutiny" };

const TABS: { key: string; label: string; statuses: ScrutinyStatus[] }[] = [
  { key: "pending", label: "Pending scrutiny", statuses: ["PENDING", "IN_PROGRESS"] },
  { key: "returned", label: "Returned", statuses: ["RETURNED"] },
  { key: "passed", label: "Passed (final review)", statuses: ["PASSED"] },
];

export default async function ScrutinyPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePageAuth("scrutiny.perform");
  const { tab } = await searchParams;
  const active = TABS.find((t) => t.key === tab) ?? TABS[0];
  const where = (t: (typeof TABS)[number]) => ({ officerId: ctx.user.id, status: { in: t.statuses }, paper: { deletedAt: null } });
  const [rows, counts] = await Promise.all([
    db.scrutiny.findMany({
      where: where(active),
      orderBy: { createdAt: "desc" },
      include: { paper: { include: { examination: { include: { course: { select: { code: true, title: true } }, session: { select: { scrutinyDeadline: true } } } } } } },
    }),
    Promise.all(TABS.map((t) => db.scrutiny.count({ where: where(t) }))),
  ]);
  return (
    <div>
      <PageHeader title="Scrutiny" description="Final technical checks — marks, numbering, instructions, formatting, equations and confidentiality — before approval." />
      <LinkTabs className="mb-4" active={active.key} tabs={TABS.map((t, i) => ({ key: t.key, label: t.label, count: counts[i], href: `/scrutiny?tab=${t.key}` }))} />
      <div className="surface-card overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-6"><EmptyState icon={ListChecks} title="Nothing here" description="Papers approved by moderators appear here for final scrutiny." /></div>
        ) : (
          <DataTable head={[{ label: "Paper" }, { label: "Course" }, { label: "Scrutiny" }, { label: "Paper status" }, { label: "Due" }, { label: "" }]}>
            {rows.map((s) => {
              const open = s.status === "PENDING" || s.status === "IN_PROGRESS";
              return (
                <tr key={s.id} className="hover:bg-muted/40">
                  <Td><span className="font-mono text-[13px]">{s.paper.code}</span></Td>
                  <Td>{s.paper.examination.course.title}</Td>
                  <Td><StatusBadge meta={SCRUTINY_STATUS[s.status]} /></Td>
                  <Td><StatusBadge meta={PAPER_STATUS[s.paper.status]} /></Td>
                  <Td>{open && s.paper.examination.session.scrutinyDeadline ? <Deadline date={s.paper.examination.session.scrutinyDeadline} compact /> : <span className="text-xs text-muted-foreground">{fmtRelative(s.completedAt ?? s.createdAt)}</span>}</Td>
                  <Td className="text-right">
                    <Button asChild size="sm" variant={open ? "default" : "outline"}>
                      <Link href={open ? `/scrutiny/${s.paperId}` : `/papers/${s.paperId}`}>{open ? "Scrutinise" : "View"}</Link>
                    </Button>
                  </Td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </div>
    </div>
  );
}
