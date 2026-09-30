import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Eye, FileDiff, GitCommitVertical, Hammer, Lock, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { RichContent } from "@/components/app/rich-content";
import { StatusBadge } from "@/components/app/status-badge";
import { WorkflowStepper } from "@/components/app/workflow-stepper";
import { Button } from "@/components/ui/button";
import { CommentThread } from "@/features/papers/comments";
import { PaperActions } from "@/features/papers/paper-actions";
import { CheckRow } from "@/features/papers/builder/blueprint-panel";
import { QuestionMeta } from "@/features/papers/builder/question-meta";
import { MODERATION_STATUS, PAPER_STATUS, SCRUTINY_STATUS, formatDuration } from "@/lib/domain/labels";
import { FINAL_EXPORTABLE } from "@/lib/domain/workflow";
import { fmtDate, fmtDateTime, fmtRelative } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { isAppError } from "@/server/errors";
import { paperDetail } from "@/server/services/paper-view";

export const metadata: Metadata = { title: "Question paper" };

export default async function PaperPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth();
  let d;
  try {
    d = await paperDetail(ctx, id);
  } catch (e) {
    if (isAppError(e)) notFound();
    throw e;
  }
  const { paper, caps, snapshot, report, actions, versionLabel } = d;
  const exam = paper.examination;
  let n = 0;
  const itemLabels = snapshot.sections.flatMap((s) => s.items.map((i) => ({ id: i.itemId, label: `Q${++n} · ${i.questionCode}` })));
  n = 0;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Question papers", href: "/papers" }, { label: paper.code }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {exam.course.code} — {exam.course.title}
            <StatusBadge meta={PAPER_STATUS[paper.status]} size="md" />
          </span>
        }
        description={`${exam.session.name} · ${exam.course.program.name} · ${exam.course.semester.name} · Set ${paper.setLabel} · Version ${versionLabel}`}
        actions={
          <>
            {caps.editContent && (
              <Button asChild size="sm">
                <Link href={`/papers/${paper.id}/builder`}><Hammer /> Open builder</Link>
              </Button>
            )}
            {caps.moderate && ["SUBMITTED", "RESUBMITTED", "UNDER_MODERATION"].includes(paper.status) && (
              <Button asChild size="sm"><Link href={`/moderation/${paper.id}`}>Moderation workspace</Link></Button>
            )}
            {caps.scrutinize && paper.status === "UNDER_SCRUTINY" && (
              <Button asChild size="sm"><Link href={`/scrutiny/${paper.id}`}>Scrutiny workspace</Link></Button>
            )}
            {caps.approve && paper.status === "AWAITING_APPROVAL" && (
              <Button asChild size="sm"><Link href={`/approvals/${paper.id}`}>Final approval</Link></Button>
            )}
            <PaperActions paperId={paper.id} actions={actions} exclude={["submit", "resubmit", "start_moderation", "moderation_approve", "moderation_request_changes", "moderation_reject", "scrutiny_pass", "scrutiny_return", "approve", "approval_return", "approval_reject"]} />
            <Button asChild variant="outline" size="sm">
              <Link href={`/papers/${paper.id}/preview`}><Eye /> Preview</Link>
            </Button>
            {caps.exportDraft && (
              <Button asChild variant="outline" size="sm">
                <a href={`/api/papers/${paper.id}/export?kind=${FINAL_EXPORTABLE.includes(paper.status) && caps.exportFinal ? "final" : ["UNDER_MODERATION", "UNDER_SCRUTINY", "AWAITING_APPROVAL", "SUBMITTED", "RESUBMITTED"].includes(paper.status) ? "moderation" : "draft"}`}>
                  <Download /> PDF
                </a>
              </Button>
            )}
          </>
        }
      />

      <div className="surface-card px-6 py-5">
        <WorkflowStepper status={paper.status} />
      </div>

      {paper.status === "LOCKED" || paper.status === "RELEASED" || paper.status === "ARCHIVED" ? (
        <div className="flex items-start gap-3 rounded-xl border border-tone-locked/25 bg-tone-locked/5 px-5 py-4">
          <Lock className="mt-0.5 size-5 text-tone-locked" />
          <div className="text-sm">
            <div className="font-semibold">Version {versionLabel} is immutable.</div>
            <div className="text-muted-foreground">
              Locked {fmtDateTime(paper.lockedAt)}. Content hash <code className="font-mono text-xs">{paper.finalHash?.slice(0, 16)}…</code>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Section
            title="Paper content"
            description={`${snapshot.sections.reduce((s, x) => s + x.items.length, 0)} questions · ${report?.totalMarks ?? "—"} marks`}
            actions={<Button asChild variant="ghost" size="sm"><Link href={`/papers/${paper.id}/preview`}>Print preview</Link></Button>}
            bodyClassName="p-0 confidential"
          >
            {snapshot.sections.map((s) => (
              <div key={s.id} className="border-b last:border-0">
                <div className="bg-surface/50 px-5 py-2.5 text-sm">
                  <b>Section {s.label}</b> <span className="text-muted-foreground">· {s.title}</span>
                </div>
                <ol>
                  {s.items.map((it) => {
                    n++;
                    return (
                      <li key={it.itemId} className="flex gap-3 border-t px-5 py-3 first:border-0">
                        <span className="w-8 shrink-0 text-sm font-semibold tabular">Q{n}.</span>
                        <div className="min-w-0 flex-1">
                          <RichContent body={it.body} options={it.options} className="font-paper text-[15px]" />
                          <QuestionMeta item={it} className="mt-1.5" />
                        </div>
                        <span className="text-sm font-semibold tabular">[{it.marks}]</span>
                      </li>
                    );
                  })}
                  {s.items.length === 0 && <li className="px-5 py-4 text-sm text-muted-foreground">No questions yet.</li>}
                </ol>
              </div>
            ))}
          </Section>

          <Section title="Review comments" description="Moderation, scrutiny and approval remarks" className="scroll-mt-20" bodyClassName="p-5">
            <div id="comments" />
            <CommentThread
              paperId={paper.id}
              canComment={caps.moderate || caps.scrutinize || caps.approve || caps.isOwner}
              canResolve={caps.isOwner || caps.moderate}
              items={itemLabels}
              comments={paper.comments.map((c) => ({ id: c.id, kind: c.kind, body: c.body, author: c.author.name, at: c.createdAt.toISOString(), resolved: c.resolved, itemLabel: c.item?.question.code ?? null }))}
            />
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Details">
            <KeyValue
              items={[
                ["Paper code", <span key="c" className="font-mono">{paper.code}</span>],
                ["Setter", paper.setter.name],
                ...(paper.assignment?.backupSetter ? [["Backup setter", paper.assignment.backupSetter.name] as [string, React.ReactNode]] : []),
                ["Moderator", exam.moderator?.name ?? "Not appointed"],
                ["Scrutiny", exam.scrutinizer?.name ?? "Not appointed"],
                ["Department", exam.course.department.name],
                ["Duration", formatDuration(exam.durationMinutes)],
                ["Maximum marks", exam.maxMarks],
                ["Exam date", exam.schedule ? `${fmtDate(exam.schedule.date)} (${exam.schedule.slot})` : "Not scheduled"],
                ["Deadline", paper.assignment ? fmtDate(paper.assignment.deadline) : "—"],
                ["Revisions", paper.revisionCount],
              ]}
            />
          </Section>

          {report && (
            <Section title="Blueprint compliance" description={`${report.compliance}% · ${report.totalMarks}/${report.requiredMarks} marks`}>
              <ul>
                {report.checks.map((c) => <CheckRow key={c.key} status={c.status} label={c.label} detail={c.detail} />)}
              </ul>
            </Section>
          )}

          <Section title="Versions" actions={paper.versions.length > 1 ? <Button asChild variant="ghost" size="sm"><Link href={`/papers/${paper.id}/versions`}><FileDiff /> Compare</Link></Button> : null} bodyClassName="p-0">
            {paper.versions.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">No versions yet. A version is recorded at each submission, moderation outcome and lock.</p>
            ) : (
              <ul className="divide-y">
                {paper.versions.map((v) => (
                  <li key={v.id} className="flex items-start gap-3 px-5 py-3">
                    <GitCommitVertical className="mt-0.5 size-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">v{v.label}</span>
                        {v.isFinal && <span className="flex items-center gap-1 text-xs text-tone-locked"><ShieldCheck className="size-3.5" /> Immutable</span>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{v.reason}</div>
                      <div className="text-xs text-muted-foreground">{v.createdBy.name} · {fmtDateTime(v.createdAt)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {(paper.moderations.length > 0 || paper.scrutinies.length > 0 || paper.approvals.length > 0) && (
            <Section title="Reviews" bodyClassName="space-y-3 p-5 text-sm">
              {paper.moderations.map((m) => (
                <div key={m.id} className="flex items-start justify-between gap-3">
                  <div><div className="font-medium">Moderation · round {m.round}</div><div className="text-xs text-muted-foreground">{m.moderator.name}{m.summary ? ` — ${m.summary}` : ""}</div></div>
                  <StatusBadge meta={MODERATION_STATUS[m.status]} />
                </div>
              ))}
              {paper.scrutinies.map((s) => (
                <div key={s.id} className="flex items-start justify-between gap-3">
                  <div><div className="font-medium">Scrutiny · round {s.round}</div><div className="text-xs text-muted-foreground">{s.officer.name}{s.remarks ? ` — ${s.remarks}` : ""}</div></div>
                  <StatusBadge meta={SCRUTINY_STATUS[s.status]} />
                </div>
              ))}
              {paper.approvals.map((a) => (
                <div key={a.id} className="flex items-start justify-between gap-3">
                  <div><div className="font-medium">Final approval · v{a.versionLabel}</div><div className="text-xs text-muted-foreground">{a.approver.name}{a.remarks ? ` — ${a.remarks}` : ""}</div></div>
                  <span className="text-xs font-semibold">{a.decision}</span>
                </div>
              ))}
            </Section>
          )}

          <Section title="History" bodyClassName="p-0">
            <ol className="relative space-y-0">
              {paper.transitions.map((t) => (
                <li key={t.id} className="flex gap-3 border-b px-5 py-3 last:border-0">
                  <StatusBadge meta={PAPER_STATUS[t.to]} className="mt-0.5" />
                  <div className="min-w-0 flex-1 text-xs">
                    <div className="text-sm">{t.actor.name}</div>
                    {t.note && <div className="text-muted-foreground">“{t.note}”</div>}
                    <div className="text-muted-foreground" title={fmtDateTime(t.createdAt)}>{fmtRelative(t.createdAt)}</div>
                  </div>
                </li>
              ))}
              <li className="px-5 py-3 text-xs text-muted-foreground">Created {fmtDateTime(paper.createdAt)}</li>
            </ol>
          </Section>
        </div>
      </div>
    </div>
  );
}
