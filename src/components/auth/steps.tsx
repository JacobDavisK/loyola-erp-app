import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** A compact progress indicator for multi-step flows (password recovery). */
export function AuthSteps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="mb-8 flex items-center gap-2" aria-label="Progress">
      {steps.map((s, i) => {
        const done = i < current, now = i === current;
        return (
          <li key={s} className="flex min-w-0 flex-1 items-center gap-2" aria-current={now ? "step" : undefined}>
            <span className={cn("grid size-6 shrink-0 place-items-center rounded-full border text-[12px] font-semibold transition-colors duration-200",
              done ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--brand-ink)]" : now ? "border-[var(--brand)] text-[var(--brand)]" : "border-[var(--line-strong)] text-[var(--text-3)]")}>
              {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
            </span>
            <span className={cn("truncate text-[13px]", now ? "font-medium text-[var(--text)]" : "text-[var(--text-3)]")}>{s}<span className="sr-only">{done ? " (done)" : now ? " (current)" : ""}</span></span>
            {i < steps.length - 1 && <span aria-hidden className={cn("h-px flex-1", done ? "bg-[var(--brand)]" : "bg-[var(--line)]")} />}
          </li>
        );
      })}
    </ol>
  );
}
