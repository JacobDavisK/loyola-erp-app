import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";
import { PackageBuilder } from "@/features/packaging/package-builder";
import { PAPER_STATUS } from "@/lib/domain/labels";
import { fmtDate } from "@/lib/format";
import { paperWhere } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { currentVersionLabel } from "@/server/services/papers";

export const metadata: Metadata = { title: "Paper packaging" };

export default async function PackagingPage() {
  const ctx = await requirePageAuth("paper.package");
  const papers = await db.questionPaper.findMany({
    where: { AND: [paperWhere(ctx), { status: { in: ["LOCKED", "RELEASED"] } }] },
    include: { examination: { include: { course: { select: { code: true, title: true } }, session: { select: { name: true, startDate: true } }, schedule: true } } },
    orderBy: [{ examination: { session: { startDate: "desc" } } }, { examination: { course: { code: "asc" } } }],
  });
  return (
    <div>
      <PageHeader title="Paper packaging" description="Assemble locked papers into individual PDFs, a single batch PDF or a complete printing package. Every package is encrypted at rest and every export is logged." />
      <PackageBuilder
        papers={papers.map((p) => ({
          id: p.id,
          code: p.code,
          course: p.examination.course.code,
          title: p.examination.course.title,
          session: p.examination.session.name,
          examDate: p.examination.schedule ? fmtDate(p.examination.schedule.date) : null,
          status: PAPER_STATUS[p.status].label,
          version: currentVersionLabel(p),
        }))}
      />
    </div>
  );
}
