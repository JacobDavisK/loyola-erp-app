import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, FileDiff, Minus, MoveRight, PenLine, Plus } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState, PageHeader, Section } from "@/components/app/page";
import { RichContent } from "@/components/app/rich-content";
import { diffSnapshots, isEmptyDiff } from "@/lib/domain/diff";
import type { PaperSnapshot } from "@/lib/domain/paper-types";
import { fmtDateTime } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { isAppError } from "@/server/errors";
import { paperForUser } from "@/server/services/papers";

export const metadata: Metadata = { title: "Compare versions" };

export default async function VersionsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ a?: string; b?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requirePageAuth();
  try {
    await paperForUser(ctx, id);
  } catch (e) {
    if (isAppError(e)) notFound();
    throw e;
  }
  const paper = await db.questionPaper.findUniqueOrThrow({ where: { id }, select: { code: true } });
  const versions = await db.questionPaperVersion.findMany({ where: { paperId: id }, orderBy: [{ major: "asc" }, { minor: "asc" }], include: { createdBy: { select: { name: true } } } });
  if (versions.length < 2) {
    return (
      <div>
        <PageHeader breadcrumbs={[{ label: "Question papers", href: "/papers" }, { label: paper.code, href: `/papers/${id}` }, { label: "Versions" }]} title="Compare versions" />
        <EmptyState icon={FileDiff} title="Only one version so far" description="Versions are recorded at submission, moderation and locking. Comparison becomes available once a second version exists." />
      </div>
    );
  }
  const a = versions.find((v) => v.id === sp.a) ?? versions[versions.length - 2];
  const b = versions.find((v) => v.id === sp.b) ?? versions[versions.length - 1];
  const diff = diffSnapshots(a.snapshot as unknown as PaperSnapshot, b.snapshot as unknown as PaperSnapshot);

  return (
    <div className="space-y-6">
      <PageHeader breadcrumbs={[{ label: "Question papers", href: "/papers" }, { label: paper.code, href: `/papers/${id}` }, { label: "Versions" }]} title="Compare versions" description="Immutable snapshots — nothing is overwritten silently." />
      <form className="surface-card flex flex-wrap items-end gap-4 p-4">
        {(["a", "b"] as const).map((k) => (
          <label key={k} className="flex flex-col gap-1 text-xs text-muted-foreground">
            {k === "a" ? "From" : "To"}
            <select name={k} defaultValue={(k === "a" ? a : b).id} className="h-9 min-w-[260px] rounded-lg border bg-card px-2 text-sm text-foreground">
              {versions.map((v) => (
                <option key={v.id} value={v.id}>v{v.label} — {v.reason.slice(0, 40)} ({fmtDateTime(v.createdAt)})</option>
              ))}
            </select>
          </label>
        ))}
        <button className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Compare</button>
      </form>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ["Added", diff.added.length, "text-tone-success"],
          ["Removed", diff.removed.length, "text-tone-danger"],
          ["Modified", diff.modified.length, "text-tone-warning"],
          ["Moved", diff.moved.length, "text-tone-info"],
          ["Marks", `${diff.marks.before} → ${diff.marks.after}`, ""],
        ].map(([l, v, c]) => (
          <div key={l as string} className="surface-card p-4">
            <div className="text-xs text-muted-foreground">{l}</div>
            <div className={`mt-1 text-xl font-semibold tabular ${c}`}>{v}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">v{a.label}</span> by {a.createdBy.name} <ArrowRight className="size-4" /> <span className="font-medium text-foreground">v{b.label}</span> by {b.createdBy.name}
      </div>

      {isEmptyDiff(diff) ? (
        <EmptyState icon={FileDiff} title="No content differences" description="These versions have identical questions, marks and instructions." />
      ) : (
        <div className="space-y-4">
          {diff.added.length > 0 && (
            <Section title="Added questions">
              <ul className="space-y-3">{diff.added.map((x) => <li key={x.item.questionId} className="flex gap-3 rounded-lg border-l-4 border-tone-success bg-tone-success/5 p-3"><Plus className="mt-0.5 size-4 text-tone-success" /><div className="flex-1"><div className="text-xs text-muted-foreground">§{x.section} · {x.item.questionCode} · {x.item.marks} marks</div><RichContent body={x.item.body} className="text-sm" /></div></li>)}</ul>
            </Section>
          )}
          {diff.removed.length > 0 && (
            <Section title="Removed questions">
              <ul className="space-y-3">{diff.removed.map((x) => <li key={x.item.questionId} className="flex gap-3 rounded-lg border-l-4 border-tone-danger bg-tone-danger/5 p-3"><Minus className="mt-0.5 size-4 text-tone-danger" /><div className="flex-1"><div className="text-xs text-muted-foreground">§{x.section} · {x.item.questionCode} · {x.item.marks} marks</div><RichContent body={x.item.body} className="text-sm line-through opacity-70" /></div></li>)}</ul>
            </Section>
          )}
          {diff.modified.length > 0 && (
            <Section title="Modified questions">
              <ul className="space-y-3">{diff.modified.map((x) => <li key={x.after.questionId} className="rounded-lg border p-3"><div className="mb-2 flex items-center gap-2 text-xs"><PenLine className="size-3.5 text-tone-warning" /> {x.after.questionCode} — {x.changes.join("; ")}</div><div className="grid gap-3 md:grid-cols-2"><RichContent body={x.before.body} className="rounded bg-tone-danger/5 p-2 text-sm" /><RichContent body={x.after.body} className="rounded bg-tone-success/5 p-2 text-sm" /></div></li>)}</ul>
            </Section>
          )}
          {diff.moved.length > 0 && (
            <Section title="Moved between sections">
              <ul className="space-y-1 text-sm">{diff.moved.map((m) => <li key={m.questionCode} className="flex items-center gap-2"><MoveRight className="size-4 text-tone-info" /> {m.questionCode}: §{m.from} → §{m.to}</li>)}</ul>
            </Section>
          )}
          {diff.instructionChanges.length > 0 && (
            <Section title="Instruction changes">
              <ul className="space-y-3 text-sm">{diff.instructionChanges.map((c) => <li key={c.scope}><div className="font-medium">{c.scope}</div><div className="mt-1 grid gap-2 md:grid-cols-2"><div className="rounded bg-tone-danger/5 p-2">{c.before || "—"}</div><div className="rounded bg-tone-success/5 p-2">{c.after || "—"}</div></div></li>)}</ul>
            </Section>
          )}
        </div>
      )}
      <div className="text-xs text-muted-foreground">
        Preview a specific version: {versions.map((v) => <Link key={v.id} className="mr-3 text-primary hover:underline" href={`/papers/${id}/preview?version=${v.id}`}>v{v.label}</Link>)}
      </div>
    </div>
  );
}
