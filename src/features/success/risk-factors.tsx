import type { RiskFactorView } from "@/features/success/labels";
import { cn } from "@/lib/utils";

/** The signals behind a risk score, strongest first: why the student was flagged. */
export function RiskFactors({ factors, compact }: { factors: RiskFactorView[]; compact?: boolean }) {
  const shown = compact ? factors.filter((f) => f.risk > 0).slice(0, 3) : factors;
  if (!shown.length) return <span className="text-xs text-muted-foreground">No concerns</span>;
  return (
    <ul className={cn("space-y-1", compact && "space-y-0.5")}>
      {shown.map((f) => (
        <li key={f.key} className="flex items-center gap-2 text-xs">
          <span className="w-28 shrink-0 font-medium">{f.label}</span>
          {!compact && (
            <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted" aria-hidden>
              <span className={cn("block h-full rounded-full", f.risk >= 0.66 ? "bg-tone-danger" : f.risk >= 0.33 ? "bg-tone-warning" : "bg-tone-success")} style={{ width: `${Math.max(4, f.risk * 100)}%` }} />
            </span>
          )}
          <span className="text-muted-foreground">{f.detail}</span>
        </li>
      ))}
    </ul>
  );
}
