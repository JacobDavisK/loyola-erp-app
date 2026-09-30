import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, CircleX, Download, Eye, Lock, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { ApprovalActions } from "@/features/review/approval-actions";
import { formatDuration, PAPER_STATUS } from "@/lib/domain/labels";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { isAppError } from "@/server/errors";
import { paperDetail } from "@/server/services/paper-view";
import { computeScrutiny } from "@/server/services/papers";
import { getSetting } from "@/server/services/settings";

export const metadata: Metadata = { title: "Final approval" };

export default async function FinalApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth("paper.approve");
  let d;
  try {
    d = await paperDetail(ctx, id);
  } catch (e) {
    if (isAppError(e)) notFound();
    throw e;
  }
  const { paper, report, versionLabel } = d;
  const exam = paper.examination;
  const [scr, workflow, lockedBy] = await Promise.all([
    computeScrutiny(id),
    getSetting("workflow"),
    paper.lockedById ? db.user.findUnique({ where: { id: paper.lockedById }, select: { name: true, roles: { include: { role: true } } } }) : null,
  ]);
  const moderation = paper.moderations[0];
  const scrutiny = paper.scrutinies[0];
  const formattingKeys = ["questionNumbering", "sectionNumbering", "marksAllocation", "specialChars", "equations", "images", "formatting", "header"];
  const formattingOk = scr.checks.filter((c) => formattingKeys.includes(c.key)).every((c) => c.ok || c.severity === "warning");
  const confidentiality = scr.checks.find((c) => c.key === "confidentiality");
  const selfApproval = paper.setterId === ctx.user.id && !workflow.allowSelfApproval;

  const rows = [
    { label: "Blueprint", ok: !!report && report.totalMarks === report.requiredMarks && report.checks.every((c) => c.status !== "fail"), detail: report ? `${report.compliance}% compliance · ${report.totalMarks}/${report.requiredMarks} marks` : "No blueprint" },
    { label: "Moderation", ok: moderation?.status === "APPROVED", detail: moderation ? `${moderation.moderator.name} · round ${moderation.round} · ${moderation.status.toLowerCase()}` : "Not moderated" },
    { label: "Scrutiny", ok: scrutiny?.status === "PASSED", detail: scrutiny ? `${scrutiny.officer.name} · ${scrutiny.status.toLowerCase()}` : "Not scrutinised" },
    { label: "Formatting", ok: formattingOk, detail: formattingOk ? "Numbering, marks, equations and layout verified" : "Formatting issues detected" },
    { label: "Confidentiality", ok: !!confidentiality?.ok, detail: confidentiality?.detail ?? "" },
  ];
  const ready = rows.every((r) => r.ok) && paper.status === "AWAITING_APPROVAL" && !selfApproval;
  const locked = ["LOCKED", "RELEASED", "ARCHIVED"].includes(paper.status);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader breadcrumbs={[{ label: "Approvals", href: "/approvals" }, { label: paper.code }]} title="Final approval" description="The last control before a paper becomes an immutable examination asset." />

      {locked ? (
        <section className="surface-card overflow-hidden">
          <div className="flex flex-col items-center gap-3 bg-tone-locked/5 px-6 py-10 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-tone-locked text-white"><Lock className="size-6" /></div>
            <h2 className="text-2xl font-semibold tracking-tight">PAPER LOCKED</h2>
            <p className="text-sm text-muted-foreground">Version {versionLabel} is now immutable.</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t px-6 py-5 text-sm">
            <dt className="text-muted-foreground">Locked by</dt>
            <dd className="font-medium">{lockedBy?.name ?? "—"}{lockedBy ? ` · ${lockedBy.roles.map((r) => r.role.name).join(", ")}` : ""}</dd>
            <dt className="text-muted-foreground">Date</dt>
            <dd className="font-medium">{fmtDateTime(paper.lockedAt)}</dd>
            <dt className="text-muted-foreground">Content hash (SHA-256)</dt>
            <dd className="font-mono text-xs break-all">{paper.finalHash}</dd>
          </dl>
          <div className="flex justify-end gap-2 border-t px-6 py-4">
            <Button asChild variant="outline"><Link href={`/papers/${id}/preview`}><Eye /> Preview</Link></Button>
            {can(ctx, "paper.export.final") && <Button asChild><a href={`/api/papers/${id}/export?kind=final`}><Download /> Final PDF</a></Button>}
          </div>
        </section>
      ) : (
        <section className="surface-card overflow-hidden">
          <div className="border-b px-6 py-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="eyebrow">Final approval</span>
              <StatusBadge meta={PAPER_STATUS[paper.status]} />
            </div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight">{exam.course.code} — {exam.course.title}</h2>
            <div className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div><div className="text-xs text-muted-foreground">Version</div><div className="font-semibold">{versionLabel}</div></div>
              <div><div className="text-xs text-muted-foreground">Total marks</div><div className="font-semibold tabular">{report?.totalMarks ?? exam.maxMarks}</div></div>
              <div><div className="text-xs text-muted-foreground">Duration</div><div className="font-semibold">{formatDuration(exam.durationMinutes)}</div></div>
              <div><div className="text-xs text-muted-foreground">Exam date</div><div className="font-semibold">{exam.schedule ? fmtDate(exam.schedule.date) : "—"}</div></div>
            </div>
          </div>
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.label} className="flex items-center gap-4 px-6 py-3.5">
                {r.ok ? <BadgeCheck className="size-5 text-tone-success" aria-hidden /> : <CircleX className="size-5 text-tone-danger" aria-hidden />}
                <div className="flex-1">
                  <div className="text-sm font-semibold">{r.label}<span className="sr-only">: {r.ok ? "verified" : "not satisfied"}</span></div>
                  <div className="text-xs text-muted-foreground">{r.detail}</div>
                </div>
              </li>
            ))}
          </ul>
          <div className={cn("px-6 py-4 text-center text-sm font-semibold tracking-wide", ready ? "bg-tone-success/10 text-tone-success" : "bg-muted text-muted-foreground")}>
            {paper.status === "APPROVED"
              ? "APPROVED — AWAITING LOCK"
              : ready
                ? "READY FOR FINAL APPROVAL"
                : selfApproval
                  ? "You set this paper and cannot approve it"
                  : paper.status !== "AWAITING_APPROVAL"
                    ? `Paper is ${PAPER_STATUS[paper.status].label.toLowerCase()}`
                    : "Not ready — resolve the items above"}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4">
            <Button asChild variant="ghost"><Link href={`/papers/${id}/preview`}><Eye /> Review paper</Link></Button>
            {paper.status === "AWAITING_APPROVAL" && d.caps.approve && !selfApproval && <ApprovalActions paperId={id} ready={ready} canLock={can(ctx, "paper.lock", exam.course.departmentId)} mode="decide" />}
            {paper.status === "APPROVED" && can(ctx, "paper.lock", exam.course.departmentId) && <ApprovalActions paperId={id} ready canLock mode="lock" />}
          </div>
        </section>
      )}
      <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" /> Every decision is recorded in the tamper-evident audit trail with your identity, device and network address.
      </p>
    </div>
  );
}
