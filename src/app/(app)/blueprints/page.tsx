import Link from "next/link";
import { Plus, Ruler } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { DIFFICULTY_LABEL, formatDuration } from "@/lib/domain/labels";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Blueprints" };

export default async function BlueprintsPage() {
  const ctx = await requirePageAuth("blueprint.view");
  const rows = await db.blueprint.findMany({
    where: { deletedAt: null },
    orderBy: [{ isPattern: "desc" }, { name: "asc" }],
    include: { course: { select: { code: true, title: true } }, sections: { orderBy: { order: "asc" } }, rules: true, _count: { select: { examinations: true, papers: true } } },
  });
  const patterns = rows.filter((r) => r.isPattern);
  const specific = rows.filter((r) => !r.isPattern);
  const card = (b: (typeof rows)[number]) => (
    <Link key={b.id} href={`/blueprints/${b.id}`} className="surface-card block p-5 transition-colors hover:border-primary/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{b.name}</h3>
          <p className="text-xs text-muted-foreground">{b.course ? `${b.course.code} — ${b.course.title}` : "Reusable pattern"} · {b.totalMarks} marks · {formatDuration(b.durationMinutes)}</p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{b._count.examinations} exams · {b._count.papers} papers</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {b.sections.map((s) => (
          <span key={s.id} className="rounded-md border px-2 py-1 text-xs tabular">
            §{s.label} {s.attemptCount !== s.questionCount ? `${s.attemptCount}/${s.questionCount}` : s.questionCount} × {s.marksPerQuestion} = {s.attemptCount * s.marksPerQuestion}
          </span>
        ))}
      </div>
      {b.rules.some((r) => r.dimension === "DIFFICULTY") && (
        <div className="mt-3 flex h-1.5 overflow-hidden rounded-full" role="img" aria-label={b.rules.filter((r) => r.dimension === "DIFFICULTY").map((r) => `${DIFFICULTY_LABEL[r.key as keyof typeof DIFFICULTY_LABEL]} ${r.targetPercent}%`).join(", ")}>
          {b.rules.filter((r) => r.dimension === "DIFFICULTY").sort((a, c) => ["EASY", "MODERATE", "HARD"].indexOf(a.key) - ["EASY", "MODERATE", "HARD"].indexOf(c.key)).map((r) => (
            <span key={r.id} className={r.key === "EASY" ? "bg-tone-success" : r.key === "MODERATE" ? "bg-tone-warning" : "bg-tone-danger"} style={{ width: `${r.targetPercent}%` }} />
          ))}
        </div>
      )}
    </Link>
  );
  return (
    <div className="space-y-8">
      <PageHeader
        title="Blueprints"
        description="Paper patterns and course blueprints: section structure, marks and the difficulty / Bloom / unit distributions every paper is validated against."
        actions={can(ctx, "blueprint.manage") ? <Button asChild size="sm"><Link href="/blueprints/new"><Plus /> New blueprint</Link></Button> : null}
      />
      {rows.length === 0 && <EmptyState icon={Ruler} title="No blueprints yet" description="Create a reusable paper pattern first; course blueprints can then be derived from it." />}
      {patterns.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Paper patterns</h2>
          <div className="grid gap-4 lg:grid-cols-2">{patterns.map(card)}</div>
        </section>
      )}
      {specific.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Course blueprints</h2>
          <div className="grid gap-4 lg:grid-cols-2">{specific.map(card)}</div>
        </section>
      )}
    </div>
  );
}
