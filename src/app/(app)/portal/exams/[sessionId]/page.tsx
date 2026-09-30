import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PrintButton } from "@/components/app/print-button";
import { fmtDate, fmtTime } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { getInstitution } from "@/server/services/directory";
import { hallTicket } from "@/server/services/exam-ops";
import { portalSubject } from "@/server/services/portal";

export const metadata: Metadata = { title: "Hall ticket" };

/** Printable hall ticket. Only confirmed papers appear; the ticket number is checked at the examination hall. */
export default async function HallTicketPage({ params, searchParams }: { params: Promise<{ sessionId: string }>; searchParams: Promise<{ student?: string }> }) {
  const { sessionId } = await params;
  const sp = await searchParams;
  const ctx = await requirePageAuth(["self.portal", "examreg.manage"]);
  const studentId = ctx.user.userType === "STAFF" ? sp.student : (await portalSubject(ctx, sp.student)).student.id;
  if (!studentId) notFound();
  const t = await hallTicket(ctx, studentId, sessionId).catch(() => null);
  if (!t) notFound();
  const inst = await getInstitution();
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex justify-end print:hidden"><PrintButton label="Print hall ticket" /></div>
      <article className="surface-card space-y-5 p-8 print:border-black print:shadow-none">
        <header className="border-b pb-4 text-center">
          <div className="text-lg font-semibold">{inst.name}</div>
          <div className="text-sm text-muted-foreground">{t.session.name}</div>
          <div className="mt-2 text-xs font-semibold tracking-[0.2em]">HALL TICKET</div>
        </header>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Hall ticket no.</dt><dd className="font-mono font-semibold">{t.ticketNo}</dd>
          <dt className="text-muted-foreground">Name</dt><dd className="font-medium">{t.student.firstName} {t.student.lastName}</dd>
          <dt className="text-muted-foreground">Student no.</dt><dd className="font-mono">{t.student.studentNo}</dd>
          <dt className="text-muted-foreground">Programme</dt><dd>{t.student.program.name} · {t.student.batch.code}</dd>
        </dl>
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2">Date</th><th>Session</th><th>Paper</th><th>Room / seat</th><th className="w-28 text-center">Invigilator</th></tr></thead>
          <tbody className="divide-y">
            {t.papers.map((p) => (
              <tr key={p.id}>
                <td className="py-2 whitespace-nowrap">{p.examination.schedule ? fmtDate(p.examination.schedule.startsAt) : "TBA"}</td>
                <td className="whitespace-nowrap">{p.examination.schedule ? `${fmtTime(p.examination.schedule.startsAt, inst.timezone)}–${fmtTime(p.examination.schedule.endsAt, inst.timezone)}` : ""}</td>
                <td><span className="font-mono text-xs">{p.examination.course.code}</span> {p.examination.course.title}</td>
                <td className="text-xs">{p.seat ? `${p.seat.room.code} · ${p.seat.seatNo}` : "Notified later"}</td>
                <td className="border-l" />
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>Bring this hall ticket and your institution identity card to every examination.</li>
          <li>Enter the hall at least 15 minutes before the start. Electronic devices are not permitted.</li>
          <li>Write only your hall ticket number on the answer booklet — never your name.</li>
        </ul>
      </article>
    </div>
  );
}
