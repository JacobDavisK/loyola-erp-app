import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/app/page";
import { PrintButton } from "@/components/app/print-button";
import { fmtDate } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Seating plan" };

/** Printable seating plan for one sitting — one block per room, in seat order, for the door and the invigilator. */
export default async function SeatingPlanPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageAuth(["seating.manage", "exam.duty"]);
  const sp = await searchParams;
  if (!sp.session || !sp.date || (sp.slot !== "FN" && sp.slot !== "AN")) notFound();
  const date = new Date(`${sp.date}T00:00:00Z`);
  // Invigilators see only rooms they are on duty in.
  const dutyRooms = can(ctx, "seating.manage") ? null : (await db.invigilationDuty.findMany({ where: { userId: ctx.user.id, sessionId: sp.session, date, slot: sp.slot }, select: { roomId: true } })).map((d) => d.roomId);
  const seats = await db.examSeat.findMany({
    where: { date, slot: sp.slot, registration: { sessionId: sp.session }, ...(dutyRooms ? { roomId: { in: dutyRooms } } : {}) },
    include: { room: { select: { code: true, name: true } }, registration: { select: { hallTicketNo: true, student: { select: { studentNo: true, firstName: true, lastName: true } }, examination: { select: { course: { select: { code: true } } } } } } },
    orderBy: [{ room: { code: "asc" } }, { seatNo: "asc" }],
  });
  const session = await db.examinationSession.findUnique({ where: { id: sp.session } });
  if (!session) notFound();
  const rooms = [...new Set(seats.map((s) => s.room.code))];
  return (
    <div className="print:text-black">
      <PageHeader title={`Seating plan — ${fmtDate(date)} ${sp.slot === "FN" ? "forenoon" : "afternoon"}`} description={`${session.name} · ${seats.length} candidates in ${rooms.length} room(s)`} actions={<PrintButton />} breadcrumbs={[{ label: "Examination operations", href: `/exam-ops?session=${sp.session}&tab=seating` }, { label: "Seating plan" }]} />
      {rooms.length === 0 && <p className="text-sm text-muted-foreground">No seats allocated{dutyRooms ? " in rooms where you are on duty" : ""}.</p>}
      <div className="space-y-6">
        {rooms.map((code) => {
          const list = seats.filter((s) => s.room.code === code);
          const papers = list.reduce<Record<string, number>>((a, s) => ((a[s.registration.examination.course.code] = (a[s.registration.examination.course.code] ?? 0) + 1), a), {});
          return (
            <Section key={code} title={`${code} — ${list[0].room.name}`} description={Object.entries(papers).map(([p, n]) => `${p}: ${n}`).join(" · ")} className="break-inside-avoid print:border-black">
              <ol className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-4">
                {list.map((s) => (
                  <li key={s.id} className="flex gap-2 border-b py-1">
                    <span className="w-7 text-right font-semibold tabular">{s.seatNo}</span>
                    <span className="min-w-0"><span className="font-mono text-xs">{s.registration.student.studentNo}</span> <span className="text-muted-foreground">{s.registration.examination.course.code}</span><span className="block truncate text-xs">{s.registration.student.firstName} {s.registration.student.lastName}</span></span>
                  </li>
                ))}
              </ol>
            </Section>
          );
        })}
      </div>
    </div>
  );
}
