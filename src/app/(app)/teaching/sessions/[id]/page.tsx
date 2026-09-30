import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";
import { AttendanceSheet } from "@/features/academic-ops/attendance-sheet";
import { fmtDateTime, fmtDayZoned, fmtTime } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { roster } from "@/server/services/attendance";
import { getInstitution } from "@/server/services/directory";

export const metadata: Metadata = { title: "Attendance" };

export default async function SessionAttendancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth(["attendance.take", "attendance.manage"]);
  const r = await roster(ctx, id).catch(() => null);
  if (!r) notFound();
  const inst = await getInstitution();
  const m = r.meeting;
  const early = m.startsAt.getTime() - new Date().getTime() > 30 * 60_000;
  const correcting = !r.editableByInstructor;
  const readOnly = m.status === "CANCELLED" || early || (correcting && !r.canCorrect);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        breadcrumbs={[{ label: "My teaching", href: "/teaching" }, { label: `${m.offering.course.code}-${m.offering.section}`, href: `/academics/offerings/${m.offeringId}?tab=sessions` }, { label: "Attendance" }]}
        title={`${m.offering.course.code} · ${m.offering.course.title}`}
        description={`${fmtDayZoned(m.startsAt, inst.timezone)}, ${fmtTime(m.startsAt, inst.timezone)}–${fmtTime(m.endsAt, inst.timezone)}${m.room ? ` · ${m.room.code}` : ""} · section ${m.offering.section}`}
      />
      {m.status === "CANCELLED" && <p className="mb-4 rounded-lg border px-4 py-3 text-sm">This session was cancelled.</p>}
      {early && <p className="mb-4 rounded-lg border px-4 py-3 text-sm">Attendance opens 30 minutes before the class starts.</p>}
      {correcting && !readOnly && <p className="mb-4 rounded-lg border border-tone-warning/40 bg-tone-warning/5 px-4 py-3 text-sm">The instructor edit window closed on {fmtDateTime(r.editableUntil)}. Your changes are recorded as corrections with the previous marks.</p>}
      {correcting && readOnly && m.status !== "CANCELLED" && !early && <p className="mb-4 rounded-lg border px-4 py-3 text-sm">The edit window closed on {fmtDateTime(r.editableUntil)}. Ask your Head of Department to correct a mark.</p>}
      {r.students.length === 0 ? (
        <p className="surface-card p-6 text-sm text-muted-foreground">No students are registered in this class.</p>
      ) : (
        <AttendanceSheet
          meetingId={id}
          readOnly={readOnly}
          correcting={correcting}
          initialTopic={m.topic ?? ""}
          students={r.students.map((s) => ({ id: s.id, studentNo: s.studentNo, name: `${s.firstName} ${s.lastName}`, mark: s.mark }))}
        />
      )}
    </div>
  );
}
