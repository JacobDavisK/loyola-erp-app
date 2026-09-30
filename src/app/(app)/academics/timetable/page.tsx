import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/app/page";
import { WeekGrid } from "@/components/app/week-grid";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { currentTerm } from "@/server/services/academic-setup";
import { timetableFor } from "@/server/services/timetable";

export const metadata: Metadata = { title: "Timetable" };

export default async function TimetablePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageAuth(["academic.view", "timetable.manage"]);
  const sp = await searchParams;
  const term = sp.term ? await db.academicTerm.findUnique({ where: { id: sp.term } }) : await currentTerm();
  const [terms, batches, rooms, instructors] = await Promise.all([
    db.academicTerm.findMany({ orderBy: { startDate: "desc" }, take: 12 }),
    db.batch.findMany({ where: { deletedAt: null }, orderBy: [{ admissionYear: "desc" }, { code: "asc" }], select: { id: true, code: true } }),
    db.room.findMany({ where: { isActive: true }, orderBy: { code: "asc" }, select: { id: true, code: true } }),
    term ? db.user.findMany({ where: { teaching: { some: { offering: { termId: term.id } } } }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
  ]);
  const view = sp.room ? "room" : sp.instructor ? "instructor" : "batch";
  const batchId = sp.batch ?? (view === "batch" ? batches[0]?.id : undefined);
  const slots = term && (batchId || sp.room || sp.instructor) ? await timetableFor(term.id, { batchId: view === "batch" ? batchId : undefined, roomId: sp.room, instructorId: sp.instructor }) : [];
  const label = view === "room" ? rooms.find((r) => r.id === sp.room)?.code : view === "instructor" ? instructors.find((i) => i.id === sp.instructor)?.name : batches.find((b) => b.id === batchId)?.code;
  const select = "h-8 rounded-lg border bg-card px-2 text-[13px]";
  return (
    <div className="space-y-6">
      <PageHeader title="Timetable" description="Weekly timetable by batch, room or instructor. Slots are edited on each class; clashes are checked when they are added." />
      <form className="flex flex-wrap gap-2">
        <select name="term" defaultValue={term?.id ?? ""} aria-label="Term" className={select}>{terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <select name="batch" defaultValue={view === "batch" ? batchId : ""} aria-label="Batch" className={select}><option value="">Batch…</option>{batches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</select>
        <select name="room" defaultValue={sp.room ?? ""} aria-label="Room" className={select}><option value="">Room…</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}</select>
        <select name="instructor" defaultValue={sp.instructor ?? ""} aria-label="Instructor" className={select}><option value="">Instructor…</option>{instructors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
        <button className="h-8 rounded-lg border px-3 text-[13px] hover:bg-muted">Show</button>
      </form>
      <Section title={label ? `${view === "batch" ? "Batch" : view === "room" ? "Room" : "Instructor"} ${label}` : "Choose a batch, room or instructor"} description={term?.name}>
        <WeekGrid
          items={slots.map((s) => ({
            id: s.id, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime, tone: s.kind === "LAB" ? "lab" : "default",
            title: `${s.offering.course.code}-${s.offering.section}`,
            subtitle: [view !== "room" ? s.room?.code : null, view !== "instructor" ? s.offering.instructors.map((i) => i.user.name.split(" ").slice(-1)[0]).join(", ") : null].filter(Boolean).join(" · "),
            href: `/academics/offerings/${s.offering.id}`,
          }))}
        />
      </Section>
    </div>
  );
}
