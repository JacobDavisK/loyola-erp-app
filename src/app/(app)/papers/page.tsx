import Link from "next/link";
import { FileText } from "lucide-react";
import type { Metadata } from "next";
import type { Prisma } from "@/generated/prisma/client";
import type { PaperStatus } from "@/generated/prisma/enums";
import { DataTable, LinkTabs, Pagination, qs, SearchForm, Td } from "@/components/app/list";
import { EmptyState, PageHeader } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { PAPER_STATUS } from "@/lib/domain/labels";
import { fmtRelative } from "@/lib/format";
import { paperWhere } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { currentVersionLabel } from "@/server/services/papers";

export const metadata: Metadata = { title: "Question papers" };

const VIEWS: { key: string; label: string; statuses?: PaperStatus[]; mine?: boolean }[] = [
  { key: "all", label: "All" },
  { key: "mine", label: "My papers", mine: true },
  { key: "drafts", label: "Drafts", statuses: ["DRAFT", "REVISION_REQUIRED"] },
  { key: "submitted", label: "Submitted", statuses: ["SUBMITTED", "RESUBMITTED"] },
  { key: "moderation", label: "Under moderation", statuses: ["SUBMITTED", "RESUBMITTED", "UNDER_MODERATION"] },
  { key: "scrutiny", label: "Under scrutiny", statuses: ["UNDER_SCRUTINY"] },
  { key: "approval", label: "Awaiting approval", statuses: ["AWAITING_APPROVAL"] },
  { key: "approved", label: "Approved", statuses: ["APPROVED"] },
  { key: "locked", label: "Locked", statuses: ["LOCKED", "RELEASED"] },
  { key: "archived", label: "Archived", statuses: ["ARCHIVED", "REJECTED"] },
];

export default async function PapersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageAuth(["paper.view.scope", "paper.edit.own", "moderation.perform", "scrutiny.perform", "paper.approve"]);
  const sp = await searchParams;
  const view = VIEWS.find((v) => v.key === sp.view) ?? VIEWS[0];
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = 20;
  const q = sp.q?.trim();

  const base: Prisma.QuestionPaperWhereInput = paperWhere(ctx);
  const filters: Prisma.QuestionPaperWhereInput[] = [base];
  if (q) filters.push({ OR: [{ code: { contains: q, mode: "insensitive" } }, { examination: { course: { title: { contains: q, mode: "insensitive" } } } }, { setter: { name: { contains: q, mode: "insensitive" } } }] });
  const where = (v: (typeof VIEWS)[number]): Prisma.QuestionPaperWhereInput => ({
    AND: [...filters, v.statuses ? { status: { in: v.statuses } } : {}, v.mine ? { OR: [{ setterId: ctx.user.id }, { assignment: { backupSetterId: ctx.user.id } }] } : {}],
  });

  const [rows, total, counts] = await Promise.all([
    db.questionPaper.findMany({
      where: where(view),
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        setter: { select: { name: true } },
        examination: { include: { course: { select: { code: true, title: true } }, session: { select: { code: true } } } },
        _count: { select: { comments: { where: { resolved: false } } } },
      },
    }),
    db.questionPaper.count({ where: where(view) }),
    Promise.all(VIEWS.map((v) => db.questionPaper.count({ where: where(v) }))),
  ]);

  return (
    <div>
      <PageHeader title="Question papers" description="Every paper you are authorised to see, across the examination workflow." />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <LinkTabs active={view.key} tabs={VIEWS.map((v, i) => ({ key: v.key, label: v.label, count: counts[i], href: `/papers${qs({ q }, { view: v.key === "all" ? undefined : v.key })}` }))} />
        <SearchForm defaultValue={q} placeholder="Search code, course or setter" hidden={{ view: sp.view }} />
      </div>
      <div className="surface-card overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={FileText} title={q ? "No papers match your search" : "No question papers yet"} description={q ? "Try a different code or course name." : "Once a paper is assigned or created, it will appear here."} />
          </div>
        ) : (
          <DataTable head={[{ label: "Paper" }, { label: "Course" }, { label: "Session" }, { label: "Setter" }, { label: "Status" }, { label: "Version" }, { label: "Updated", className: "text-right" }]}>
            {rows.map((p) => (
              <tr key={p.id} className="group hover:bg-muted/40">
                <Td>
                  <Link href={`/papers/${p.id}`} className="font-mono text-[13px] font-medium whitespace-nowrap text-primary hover:underline">{p.code}</Link>
                  {p._count.comments > 0 && <div className="text-[11px] text-tone-warning">{p._count.comments} open comment(s)</div>}
                </Td>
                <Td><div className="max-w-[260px] truncate">{p.examination.course.title}</div></Td>
                <Td className="text-muted-foreground">{p.examination.session.code}</Td>
                <Td>{p.setter.name}</Td>
                <Td><StatusBadge meta={PAPER_STATUS[p.status]} /></Td>
                <Td className="tabular">{currentVersionLabel(p)}</Td>
                <Td className="text-right text-xs whitespace-nowrap text-muted-foreground">{fmtRelative(p.updatedAt)}</Td>
              </tr>
            ))}
          </DataTable>
        )}
        <Pagination page={page} pageSize={pageSize} total={total} hrefFor={(p) => `/papers${qs({ view: sp.view, q }, { page: p })}`} />
      </div>
    </div>
  );
}
