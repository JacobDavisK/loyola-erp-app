import Link from "next/link";
import { DAY_NAMES } from "@/lib/domain/timetable";
import { cn } from "@/lib/utils";

export interface WeekItem {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  title: string;
  subtitle?: string;
  href?: string;
  tone?: "default" | "lab";
}

/**
 * Weekly timetable. Days are columns on wide screens and stacked sections on phones; each class is a
 * card with its time, so the layout stays readable at any number of classes and works with screen readers.
 */
export function WeekGrid({ items, highlightDay }: { items: WeekItem[]; highlightDay?: number }) {
  const days = [1, 2, 3, 4, 5, 6, ...(items.some((i) => i.dayOfWeek === 7) ? [7] : [])];
  return (
    <div className={cn("grid gap-3 md:gap-2", days.length === 7 ? "md:grid-cols-7" : "md:grid-cols-6")}>
      {days.map((d) => {
        const list = items.filter((i) => i.dayOfWeek === d).sort((a, b) => a.startTime.localeCompare(b.startTime));
        return (
          <section key={d} aria-label={DAY_NAMES[d]} className={cn("min-w-0 rounded-xl border bg-card/50 p-2", highlightDay === d && "border-primary/40 bg-primary/5")}>
            <h3 className={cn("mb-2 px-1 text-xs font-semibold", highlightDay === d ? "text-primary" : "text-muted-foreground")}>{DAY_NAMES[d]}{highlightDay === d && <span className="sr-only"> (today)</span>}</h3>
            {list.length === 0 ? (
              <p className="px-1 pb-1 text-xs text-muted-foreground/70">—</p>
            ) : (
              <ul className="space-y-1.5">
                {list.map((i) => {
                  const body = (
                    <>
                      <div className="text-[11px] text-muted-foreground tabular">{i.startTime}–{i.endTime}</div>
                      <div className="truncate text-[13px] font-medium">{i.title}</div>
                      {i.subtitle && <div className="truncate text-[11px] text-muted-foreground">{i.subtitle}</div>}
                    </>
                  );
                  const cls = cn("block rounded-lg border-l-[3px] bg-card px-2 py-1.5 shadow-[var(--shadow-soft)]", i.tone === "lab" ? "border-l-tone-progress" : "border-l-primary");
                  return <li key={i.id}>{i.href ? <Link href={i.href} className={cn(cls, "hover:bg-muted/60")}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
