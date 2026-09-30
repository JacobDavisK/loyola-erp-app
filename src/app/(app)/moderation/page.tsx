import Link from "next/link";
import { ScanSearch } from "lucide-react";
import type { Metadata } from "next";
import type { ModerationStatus } from "@/generated/prisma/enums";
import { DataTable, LinkTabs, Td } from "@/components/app/list";
import { EmptyState, PageHeader } from "@/components/app/page";
import { Deadline } from "@/components/app/deadline";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { MODERATION_STATUS, PAPER_STATUS } from "@/lib/domain/labels";
import { fmtRelative } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Moderation" };

const TABS: { key: string; label: string; statuses: ModerationStatus[] }[] = [
  { key: "pending", label: "Pending moderation", statuses: ["PENDING"] },
  { key: "review", label: "In review", statuses: ["IN_REVIEW"] },
  { key: "returned", label: "Returned", statuses: ["CHANGES_REQUESTED", "REJECTED"] },
  { key: "approved", label: "Approved", statuses: ["APPROVED"] },
];

export default async function ModerationPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePageAuth("moderation.perform");
  const { tab } = await searchParams;
  const active = TABS.find((t) => t.key === tab) ?? TABS[0];
  const where = (t: (typeof TABS)[number]) => ({ moderatorId: ctx.user.id, status: { in: t.statuses }, paper: { deletedAt: null } });
  const [rows, counts] = await Promise.all([
    db.moderation.findMany({
      where: where(active),
      orderBy: { createdAt: "desc" },
      include: {
        paper: { include: { setter: { select: { name: true } }, examination: { include: { course: { select: { code: true, title: true } }, session: { select: { name: true, moderationDeadline: true } } } } } },
      },
    }),
    Promise.all(TABS.map((t) => db.moderation.count({ where: where(t) }))),
  ]);
  return (
    <div>
      <PageHeader title="Moderation" description="Papers assigned to you for moderation. Review each question against the blueprint, syllabus and quality standards." />
      <LinkTabs className="mb-4" active={active.key} tabs={TABS.map((t, i) => ({ key: t.key, label: t.label, count: counts[i], href: `/moderation?tab=${t.key}` }))} />
      <div className="surface-card overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-6"><EmptyState icon={ScanSearch} title="Nothing here" description={active.key === "pending" ? "When a setter submits a paper you moderate, it appears here." : "No papers in this state."} /></div>
        ) : (
          <DataTable head={[{ label: "Paper" }, { label: "Course" }, { label: "Setter" }, { label: "Round" }, { label: "Moderation" }, { label: "Paper status" }, { label: "Due" }, { label: "" }]}>
            {rows.map((m) => (
              <tr key={m.id} className="hover:bg-muted/40">
                <Td><span className="font-mono text-[13px]">{m.paper.code}</span></Td>
                <Td><div className="max-w-[240px] truncate">{m.paper.examination.course.title}</div></Td>
                <Td>{m.paper.setter.name}</Td>
                <Td className="tabular">{m.round}</Td>
                <Td><StatusBadge meta={MODERATION_STATUS[m.status]} /></Td>
                <Td><StatusBadge meta={PAPER_STATUS[m.paper.status]} /></Td>
                <Td>{m.paper.examination.session.moderationDeadline && ["PENDING", "IN_REVIEW"].includes(m.status) ? <Deadline date={m.paper.examination.session.moderationDeadline} compact /> : <span className="text-xs text-muted-foreground">{fmtRelative(m.completedAt ?? m.createdAt)}</span>}</Td>
                <Td className="text-right">
                  <Button asChild size="sm" variant={["PENDING", "IN_REVIEW"].includes(m.status) ? "default" : "outline"}>
                    <Link href={["PENDING", "IN_REVIEW"].includes(m.status) ? `/moderation/${m.paperId}` : `/papers/${m.paperId}`}>{m.status === "PENDING" ? "Review" : m.status === "IN_REVIEW" ? "Continue" : "View"}</Link>
                  </Button>
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
      </div>
    </div>
  );
}
