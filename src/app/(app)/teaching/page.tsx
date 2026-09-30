import Link from "next/link";
import { CalendarCheck, CheckCircle2, Clock, School } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState, PageHeader, Section, StatCard } from "@/components/app/page";
import { WeekGrid } from "@/components/app/week-grid";
import { fmtDayZoned, fmtTime } from "@/lib/format";
import { isoWeekday } from "@/lib/domain/timetable";
import { cn } from "@/lib/utils";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { currentTerm } from "@/server/services/academic-setup";
import { getInstitution } from "@/server/services/directory";

export const metadata: Metadata = { title: "My teaching" };

function zonedDayBounds(now: Date, timeZone: string) {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return ymd;
}

export default async function TeachingPage() {
  const ctx = await requirePageAuth(["attendance.take"]);
  const [inst, term] = await Promise.all([getInstitution(), currentTerm()]);
  if (!term) return <div><PageHeader title="My teaching" /><EmptyState icon={School} title="No current term" description="The Registrar has not set the current term yet." /></div>;
  const uid = ctx.user.id;
  const now = new Date();
  const today = zonedDayBounds(now, inst.timezone);
  const [offerings, todays, pending, slots] = await Promise.all([
    db.courseOffering.findMany({
      where: { termId: term.id, instructors: { some: { userId: uid } }, status: { not: "CANCELLED" } },
      include: { course: { select: { code: true, title: true } }, _count: { select: { registrations: { where: { status: "REGISTERED" } }, meetings: { where: { status: "HELD" } } } } },
      orderBy: { course: { code: "asc" } },
    }),
    db.classMeeting.findMany({
      where: { offering: { instructors: { some: { userId: uid } } }, date: new Date(`${today}T00:00:00Z`), status: { not: "CANCELLED" } },
      include: { offering: { select: { section: true, course: { select: { code: true, title: true } } } }, room: { select: { code: true } }, _count: { select: { records: true } } },
      orderBy: { startsAt: "asc" },
    }),
    db.classMeeting.count({ where: { offering: { instructors: { some: { userId: uid } } }, status: "SCHEDULED", endsAt: { lt: now } } }),
    db.timetableSlot.findMany({ where: { offering: { termId: term.id, instructors: { some: { userId: uid } }, status: { not: "CANCELLED" } } }, include: { room: { select: { code: true } }, offering: { select: { id: true, section: true, course: { select: { code: true } } } } } }),
  ]);
  const weekday = isoWeekday(new Date(`${today}T00:00:00Z`));
  return (
    <div className="space-y-6">
      <PageHeader title="My teaching" description={`${term.name} · ${fmtDayZoned(now, inst.timezone)}`} />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        <StatCard label="Classes this term" value={offerings.length} icon={School} />
        <StatCard label="Students" value={offerings.reduce((a, o) => a + o._count.registrations, 0)} />
        <StatCard label="Today's sessions" value={todays.length} icon={CalendarCheck} />
        <StatCard label="Attendance not taken" value={pending} icon={Clock} tone={pending ? "warning" : undefined} hint={pending ? "Past sessions still unmarked" : "All caught up"} />
      </div>
      <Section title="Today">
        {todays.length === 0 ? <p className="text-sm text-muted-foreground">No classes today.</p> : (
          <ul className="divide-y">
            {todays.map((m) => {
              const done = m._count.records > 0;
              const live = m.startsAt.getTime() - now.getTime() < 30 * 60_000;
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="w-28 text-sm tabular">{fmtTime(m.startsAt, inst.timezone)}–{fmtTime(m.endsAt, inst.timezone)}</span>
                  <span className="min-w-40 flex-1"><span className="font-mono text-xs text-muted-foreground">{m.offering.course.code}-{m.offering.section}</span> {m.offering.course.title}<span className="block text-xs text-muted-foreground">{m.room?.code ?? "No room"}</span></span>
                  {done ? (
                    <Link href={`/teaching/sessions/${m.id}`} className="flex items-center gap-1 text-sm text-tone-success hover:underline"><CheckCircle2 className="size-4" /> {m._count.records} marked</Link>
                  ) : (
                    <Link href={`/teaching/sessions/${m.id}`} className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", live ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border text-muted-foreground")}>{live ? "Take attendance" : "Opens 30 min before"}</Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <Section title="Weekly timetable">
        <WeekGrid highlightDay={weekday} items={slots.map((s) => ({ id: s.id, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime, title: `${s.offering.course.code}-${s.offering.section}`, subtitle: s.room?.code, href: `/academics/offerings/${s.offering.id}`, tone: s.kind === "LAB" ? "lab" : "default" }))} />
      </Section>
      <Section title="My classes" bodyClassName="p-0">
        {offerings.length === 0 ? <p className="px-5 py-4 text-sm text-muted-foreground">You are not assigned to any class this term.</p> : (
          <ul className="divide-y">
            {offerings.map((o) => (
              <li key={o.id}>
                <Link href={`/teaching/courses/${o.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/40">
                  <span className="flex-1"><span className="font-mono text-xs text-muted-foreground">{o.course.code}-{o.section}</span> <span className="font-medium">{o.course.title}</span></span>
                  <span className="text-xs text-muted-foreground tabular">{o._count.registrations} students · {o._count.meetings} sessions held</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
