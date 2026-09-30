import { cn } from "@/lib/utils";

/** Workflow funnel: counts per pipeline stage, rendered as accessible labelled bars. */
export function WorkflowFunnel({ stages }: { stages: { key: string; label: string; count: number }[] }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <ol className="space-y-2.5" aria-label="Question paper workflow">
      {stages.map((s, i) => (
        <li key={s.key} className="grid grid-cols-[110px_1fr_36px] items-center gap-3 text-sm">
          <span className="flex items-center gap-2 text-muted-foreground">
            <span className="grid size-5 place-items-center rounded-full bg-muted text-[10.5px] font-semibold text-foreground tabular">{i + 1}</span>
            {s.label}
          </span>
          <span className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <span
              className={cn("block h-full rounded-full bg-primary transition-[width] duration-700", s.key === "locked" && "bg-tone-locked", s.key === "approved" && "bg-tone-success")}
              style={{ width: `${(s.count / max) * 100}%`, opacity: s.count ? 1 : 0 }}
            />
          </span>
          <span className="text-right font-semibold tabular">{s.count}</span>
        </li>
      ))}
    </ol>
  );
}

/** Segmented progress of papers in a session. */
export function SegmentedProgress({ segments, total }: { segments: { label: string; value: number; className: string }[]; total: number }) {
  return (
    <div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(", ")}>
        {segments.map((s) => (
          <span key={s.label} className={cn("h-full", s.className)} style={{ width: `${total ? (s.value / total) * 100 : 0}%` }} />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2 rounded-full", s.className)} />
            {s.label} <span className="font-semibold text-foreground tabular">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
