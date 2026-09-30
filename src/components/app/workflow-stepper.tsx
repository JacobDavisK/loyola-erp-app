import { Check } from "lucide-react";
import type { PaperStatus } from "@/generated/prisma/enums";
import { PIPELINE, pipelineIndex } from "@/lib/domain/workflow";
import { cn } from "@/lib/utils";

export function WorkflowStepper({ status }: { status: PaperStatus }) {
  const idx = pipelineIndex(status);
  const rejected = status === "REJECTED";
  const returned = status === "REVISION_REQUIRED";
  return (
    <ol className="flex w-full items-center" aria-label="Workflow progress">
      {PIPELINE.map((p, i) => {
        const done = !rejected && i < idx;
        const current = !rejected && i === idx;
        return (
          <li key={p.key} className="flex flex-1 items-center last:flex-none" aria-current={current ? "step" : undefined}>
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={cn(
                  "grid size-7 place-items-center rounded-full border-2 text-[11px] font-semibold transition-colors",
                  done && "border-primary bg-primary text-primary-foreground",
                  current && (returned ? "border-tone-warning bg-tone-warning/10 text-tone-warning" : "border-primary bg-primary/10 text-primary"),
                  !done && !current && "border-border bg-card text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              <span className={cn("hidden text-[11px] whitespace-nowrap sm:block", current ? "font-semibold text-foreground" : "text-muted-foreground")}>
                {current && returned ? "Revision" : p.label}
                <span className="sr-only">{done ? " (completed)" : current ? " (current)" : ""}</span>
              </span>
            </div>
            {i < PIPELINE.length - 1 && <span aria-hidden className={cn("mx-1.5 mb-5 h-0.5 flex-1 rounded sm:mb-5", done ? "bg-primary" : "bg-border")} />}
          </li>
        );
      })}
    </ol>
  );
}
