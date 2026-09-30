import Link from "next/link";
import { Stamp } from "lucide-react";
import type { Metadata } from "next";
import type { PaperStatus } from "@/generated/prisma/enums";
import { DataTable, LinkTabs, Td } from "@/components/app/list";
import { Deadline } from "@/components/app/deadline";
import { EmptyState, PageHeader } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { PAPER_STATUS } from "@/lib/domain/labels";
import { fmtRelative } from "@/lib/format";
import { paperWhere } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { currentVersionLabel } from "@/server/services/papers";

export const metadata: Metadata = { title: "Approvals" };

const TABS: { key: string; label: string; statuses: PaperStatus[] }[] = [
  { key: "pending", label: "Awaiting approval", statuses: ["AWAITING_APPROVAL"] },
  { key: "approved", label: "Approved, not locked", statuses: ["APPROVED"] },
  { key: "locked", label: "Locked", statuses: ["LOCKED", "RELEASED"] },
];

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePageAuth("paper.approve");
  const { tab } = await searchParams;
  const active = TABS.find((t) => t.key === tab) ?? TABS[0];
  const where = (t: (typeof TABS)[number]) => ({ AND: [paperWhere(ctx), { status: { in: t.statuses } }] });
  const [rows, counts] = await Promise.all([
    db.questionPaper.findMany({
      where: where(active),
      orderBy: { updatedAt: "asc" },
      include: { setter: { select: { name: true } }, examination: { include: { course: { select: { code: true, title: true } }, session: { select: { approvalDeadline: true, code: true } } } } },
    }),
    Promise.all(TABS.map((t) => db.questionPaper.count({ where: where(t) }))),
  ]);
  return (
    <div>
      <PageHeader title="Approvals" description="Papers that have passed moderation and scrutiny and await the approving authority." />
      <LinkTabs className="mb-4" active={active.key} tabs={TABS.map((t, i) => ({ key: t.key, label: t.label, count: counts[i], href: `/approvals?tab=${t.key}` }))} />
      <div className="surface-card overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-6"><EmptyState icon={Stamp} title="No papers awaiting approval" description="Papers appear here once they pass final scrutiny." /></div>
        ) : (
          <DataTable head={[{ label: "Paper" }, { label: "Course" }, { label: "Setter" }, { label: "Version" }, { label: "Status" }, { label: "Due" }, { label: "" }]}>
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-muted/40">
                <Td><span className="font-mono text-[13px]">{p.code}</span></Td>
                <Td>{p.examination.course.title}</Td>
                <Td>{p.setter.name}</Td>
                <Td className="tabular">{currentVersionLabel(p)}</Td>
                <Td><StatusBadge meta={PAPER_STATUS[p.status]} /></Td>
                <Td>{p.status === "AWAITING_APPROVAL" && p.examination.session.approvalDeadline ? <Deadline date={p.examination.session.approvalDeadline} compact /> : <span className="text-xs text-muted-foreground">{fmtRelative(p.updatedAt)}</span>}</Td>
                <Td className="text-right"><Button asChild size="sm" variant={p.status === "AWAITING_APPROVAL" ? "default" : "outline"}><Link href={`/approvals/${p.id}`}>{p.status === "AWAITING_APPROVAL" ? "Review" : "Open"}</Link></Button></Td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>
    </div>
  );
}
