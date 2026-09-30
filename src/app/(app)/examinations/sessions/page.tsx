import Link from "next/link";
import { CalendarRange } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/app/page";
import { SegmentedProgress } from "@/components/app/pipeline";
import { StatusBadge } from "@/components/app/status-badge";
import { SessionFormDialog } from "@/features/examinations/session-form";
import { EXAM_TYPE_LABEL, SESSION_STATUS } from "@/lib/domain/labels";
import { fmtDate } from "@/lib/format";
import { examinationWhere } from "@/server/auth/access";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Examination sessions" };

export default async function SessionsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const ctx = await requirePageAuth(["exam.view", "session.manage"]);
  const sp = await searchParams;
  const scope = examinationWhere(ctx);
  const [sessions, years, programs] = await Promise.all([
    db.examinationSession.findMany({
      orderBy: { startDate: "desc" },
      include: {
        academicYear: { select: { label: true } },
        programs: { select: { code: true } },
        examinations: { where: scope, select: { papers: { where: { deletedAt: null }, select: { status: true } } } },
      },
    }),
    db.academicYear.findMany({ orderBy: { startDate: "desc" }, select: { id: true, label: true } }),
    db.program.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);
  const manage = can(ctx, "session.manage");

  return (
    <div>
      <PageHeader
        title="Examination sessions"
        description="Each session groups one term's examinations and carries its paper-setting, moderation, scrutiny and approval deadlines."
        actions={manage ? <SessionFormDialog years={years} programs={programs} defaultOpen={sp.new === "1"} /> : null}
      />
      {sessions.length === 0 ? (
        <EmptyState icon={CalendarRange} title="No examination sessions yet" description="Create a session to start scheduling examinations and appointing paper setters." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sessions.map((s) => {
            const statuses = s.examinations.flatMap((e) => e.papers.map((p) => p.status));
            const locked = statuses.filter((x) => ["LOCKED", "RELEASED", "ARCHIVED"].includes(x)).length;
            const review = statuses.filter((x) => ["SUBMITTED", "RESUBMITTED", "UNDER_MODERATION", "UNDER_SCRUTINY", "AWAITING_APPROVAL", "APPROVED"].includes(x)).length;
            const prep = statuses.filter((x) => ["DRAFT", "REVISION_REQUIRED"].includes(x)).length;
            const total = s.examinations.length;
            return (
              <Link key={s.id} href={`/examinations/sessions/${s.id}`} className="surface-card block p-5 transition-colors hover:border-primary/30">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-muted-foreground">{s.code} · {EXAM_TYPE_LABEL[s.examType]} · {s.academicYear.label}</div>
                    <h2 className="mt-1 text-[15px] font-semibold">{s.name}</h2>
                    <div className="mt-1 text-xs text-muted-foreground">{fmtDate(s.startDate)} – {fmtDate(s.endDate)} · {s.programs.map((p) => p.code).join(", ") || "No programmes"}</div>
                  </div>
                  <StatusBadge meta={SESSION_STATUS[s.status]} />
                </div>
                <div className="mt-5">
                  <SegmentedProgress
                    total={Math.max(total, 1)}
                    segments={[
                      { label: "Locked", value: locked, className: "bg-tone-locked" },
                      { label: "In review", value: review, className: "bg-tone-progress" },
                      { label: "In preparation", value: prep, className: "bg-primary/40" },
                      { label: "Not started", value: Math.max(0, total - locked - review - prep), className: "bg-muted-foreground/20" },
                    ]}
                  />
                </div>
                <div className="mt-3 text-xs text-muted-foreground">{total} examination{total === 1 ? "" : "s"} in your scope</div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
