"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  addDays, addMonths, addWeeks, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isToday, startOfMonth, startOfWeek,
} from "date-fns";
import { AlarmClock, CalendarCheck, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface CalendarEvent {
  id: string;
  date: string; // ISO
  kind: "exam" | "deadline";
  title: string;
  subtitle?: string;
  href?: string;
  tone: "exam" | "setting" | "moderation" | "scrutiny" | "approval" | "overdue";
  status?: string;
}

type View = "month" | "week" | "day" | "list";

const TONE: Record<CalendarEvent["tone"], string> = {
  exam: "border-l-primary bg-primary/8 text-foreground",
  setting: "border-l-tone-info bg-tone-info/8",
  moderation: "border-l-tone-progress bg-tone-progress/8",
  scrutiny: "border-l-tone-warning bg-tone-warning/10",
  approval: "border-l-tone-success bg-tone-success/8",
  overdue: "border-l-tone-danger bg-tone-danger/8",
};

function EventChip({ e, compact }: { e: CalendarEvent; compact?: boolean }) {
  const Icon = e.kind === "exam" ? FileText : e.tone === "overdue" ? AlarmClock : CalendarCheck;
  const body = (
    <span className={cn("flex items-start gap-1.5 rounded-md border-l-[3px] px-1.5 py-1 text-left text-[11.5px] leading-tight", TONE[e.tone])}>
      <Icon aria-hidden className="mt-px size-3 shrink-0 opacity-70" />
      <span className="min-w-0">
        <span className={cn("block font-medium", compact && "truncate")}>{e.title}</span>
        {!compact && e.subtitle && <span className="block text-muted-foreground">{e.subtitle}</span>}
      </span>
    </span>
  );
  return e.href ? <Link href={e.href} className="block hover:opacity-80">{body}</Link> : body;
}

export function CalendarView({ events, initialDate }: { events: CalendarEvent[]; initialDate: string }) {
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => new Date(initialDate));
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const k = e.date.slice(0, 10);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return m;
  }, [events]);
  const dayKey = (d: Date) => format(d, "yyyy-MM-dd");
  const move = (dir: 1 | -1) => setCursor((c) => (view === "month" ? addMonths(c, dir) : view === "week" ? addWeeks(c, dir) : view === "day" ? addDays(c, dir) : addMonths(c, dir)));

  const title = view === "day" ? format(cursor, "EEEE, d MMMM yyyy") : view === "week" ? `${format(startOfWeek(cursor, { weekStartsOn: 1 }), "d MMM")} – ${format(endOfWeek(cursor, { weekStartsOn: 1 }), "d MMM yyyy")}` : format(cursor, "MMMM yyyy");

  return (
    <div className="surface-card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <Button variant="ghost" size="icon-sm" onClick={() => move(-1)} aria-label="Previous"><ChevronLeft /></Button>
        <Button variant="ghost" size="icon-sm" onClick={() => move(1)} aria-label="Next"><ChevronRight /></Button>
        <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>Today</Button>
        <h2 className="ml-2 text-[15px] font-semibold" aria-live="polite">{title}</h2>
        <div className="ml-auto flex rounded-lg border p-0.5" role="tablist" aria-label="Calendar view">
          {(["month", "week", "day", "list"] as View[]).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={cn("rounded-md px-3 py-1 text-xs font-medium capitalize", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === "month" && (
        <div role="grid" aria-label={title}>
          <div className="grid grid-cols-7 border-b text-center text-[11px] font-medium text-muted-foreground" role="row">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-2" role="columnheader">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {(() => {
              const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
              const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
              const days: Date[] = [];
              for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
              return days.map((d) => {
                const list = byDay.get(dayKey(d)) ?? [];
                return (
                  <div key={d.toISOString()} role="gridcell" aria-label={`${format(d, "d MMMM")}: ${list.length} event(s)`} className={cn("min-h-28 border-r border-b p-1.5 [&:nth-child(7n)]:border-r-0", !isSameMonth(d, cursor) && "bg-muted/30")}>
                    <button type="button" onClick={() => { setCursor(d); setView("day"); }} className={cn("mb-1 grid size-6 place-items-center rounded-full text-xs tabular hover:bg-muted", isToday(d) && "bg-primary font-semibold text-primary-foreground hover:bg-primary", !isSameMonth(d, cursor) && "text-muted-foreground")}>
                      {format(d, "d")}
                    </button>
                    <div className="space-y-1">
                      {list.slice(0, 3).map((e) => <EventChip key={e.id} e={e} compact />)}
                      {list.length > 3 && <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => { setCursor(d); setView("day"); }}>+{list.length - 3} more</button>}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      {view === "week" && (
        <div className="grid grid-cols-1 divide-y md:grid-cols-7 md:divide-x md:divide-y-0">
          {Array.from({ length: 7 }).map((_, i) => {
            const d = addDays(startOfWeek(cursor, { weekStartsOn: 1 }), i);
            const list = byDay.get(dayKey(d)) ?? [];
            return (
              <div key={i} className="min-h-64 p-2">
                <div className={cn("mb-2 text-xs font-semibold", isToday(d) && "text-primary")}>{format(d, "EEE d")}</div>
                <div className="space-y-1.5">{list.map((e) => <EventChip key={e.id} e={e} />)}</div>
              </div>
            );
          })}
        </div>
      )}

      {view === "day" && (
        <div className="space-y-2 p-4">
          {(byDay.get(dayKey(cursor)) ?? []).length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Nothing scheduled.</p>}
          {(byDay.get(dayKey(cursor)) ?? []).map((e) => <EventChip key={e.id} e={e} />)}
        </div>
      )}

      {view === "list" && (
        <ul className="divide-y">
          {[...byDay.entries()]
            .filter(([k]) => isSameMonth(new Date(k), cursor))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, list]) => (
              <li key={k} className="grid gap-3 px-4 py-3 sm:grid-cols-[140px_1fr]">
                <div className={cn("text-sm font-medium", isSameDay(new Date(k), new Date()) && "text-primary")}>{format(new Date(k), "EEE, d MMM")}</div>
                <div className="grid gap-1.5 sm:grid-cols-2">{list.map((e) => <EventChip key={e.id} e={e} />)}</div>
              </li>
            ))}
          {![...byDay.keys()].some((k) => isSameMonth(new Date(k), cursor)) && <li className="py-10 text-center text-sm text-muted-foreground">No events this month.</li>}
        </ul>
      )}

      <div className="flex flex-wrap gap-4 border-t px-4 py-2.5 text-[11px] text-muted-foreground">
        {([["exam", "Examination"], ["setting", "Setter deadline"], ["moderation", "Moderation deadline"], ["scrutiny", "Scrutiny deadline"], ["approval", "Approval deadline"], ["overdue", "Overdue"]] as const).map(([t, l]) => (
          <span key={t} className="flex items-center gap-1.5"><span aria-hidden className={cn("h-3 w-1 rounded-sm border-l-[3px]", TONE[t])} />{l}</span>
        ))}
      </div>
    </div>
  );
}
