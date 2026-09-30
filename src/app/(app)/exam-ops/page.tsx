import Link from "next/link";
import { FileCheck2, Ticket } from "lucide-react";
import type { Metadata } from "next";
import type { Prisma } from "@/generated/prisma/client";
import { DataTable, LinkTabs, Pagination, qs, Td } from "@/components/app/list";
import { EmptyState, PageHeader, Section, StatCard } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { generateRegistrationsAction, issueHallTicketsAction, codeScriptsAction } from "@/features/results/actions";
import { createExamFeeInvoicesAction } from "@/features/finance/actions";
import { ActionButton } from "@/features/academic-ops/controls";
import { AllocateForm, AssignValuersForm, DutyForm, EligibilityControls, RemoveDutyButton } from "@/features/results/ops-panels";
import { EXAM_REG_STATUS } from "@/lib/domain/labels";
import { fmtDate, fmtTime } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { getInstitution, usersWithPermission } from "@/server/services/directory";
import { getSetting } from "@/server/services/settings";

export const metadata: Metadata = { title: "Examination operations" };

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export default async function ExamOpsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageAuth(["examreg.manage", "seating.manage", "valuation.manage"]);
  const sp = await searchParams;
  const sessions = await db.examinationSession.findMany({ where: { status: { not: "ARCHIVED" } }, orderBy: { startDate: "desc" }, include: { _count: { select: { examinations: true } } } });
  const session = sessions.find((s) => s.id === sp.session) ?? sessions.find((s) => s.termId && s._count.examinations > 0) ?? sessions[0];
  if (!session) return <div><PageHeader title="Examination operations" /><EmptyState icon={Ticket} title="No open examination session" /></div>;
  const tab = sp.tab ?? "registrations";
  const base = { session: session.id };
  const tabs = [
    { key: "registrations", label: "Registrations & hall tickets", href: `/exam-ops${qs(base, {})}` },
    { key: "seating", label: "Seating", href: `/exam-ops${qs(base, { tab: "seating" })}` },
    { key: "duties", label: "Invigilation", href: `/exam-ops${qs(base, { tab: "duties" })}` },
    { key: "scripts", label: "Scripts & valuation", href: `/exam-ops${qs(base, { tab: "scripts" })}` },
  ];
  const counts = await db.examRegistration.groupBy({ by: ["status"], where: { sessionId: session.id }, _count: { _all: true } });
  const count = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Examination operations"
        description="Eligibility and hall tickets, seating, invigilation and answer-script valuation for a session."
        actions={
          <form className="flex gap-2">
            <select name="session" defaultValue={session.id} aria-label="Session" className="h-8 rounded-lg border bg-card px-2 text-[13px]">{sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <button className="h-8 rounded-lg border px-3 text-[13px] hover:bg-muted">Open</button>
          </form>
        }
      />
      {!session.termId && <p className="rounded-lg border border-tone-warning/40 bg-tone-warning/5 px-4 py-3 text-sm">This session is not linked to a teaching term, so eligibility cannot be derived from class registrations and attendance.</p>}
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
        <StatCard label="Eligible (awaiting ticket)" value={count("ELIGIBLE")} icon={FileCheck2} />
        <StatCard label="Hall tickets issued" value={count("REGISTERED")} icon={Ticket} tone="success" />
        <StatCard label="Condonation needed" value={count("CONDONATION_PENDING")} tone={count("CONDONATION_PENDING") ? "warning" : undefined} />
        <StatCard label="Not eligible" value={count("NOT_ELIGIBLE")} tone={count("NOT_ELIGIBLE") ? "danger" : undefined} />
      </div>
      <LinkTabs tabs={tabs} active={tab} />
      {tab === "registrations" && <Registrations />}
      {tab === "seating" && <Seating />}
      {tab === "duties" && <Duties />}
      {tab === "scripts" && <Scripts />}
    </div>
  );

  async function Registrations() {
    const page = Math.max(1, Number(sp.page) || 1);
    const pageSize = 50;
    const where: Prisma.ExamRegistrationWhereInput = { sessionId: session.id, ...(sp.status ? { status: sp.status as never } : {}), ...(sp.exam ? { examinationId: sp.exam } : {}) };
    const [rows, total, exams] = await Promise.all([
      db.examRegistration.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: [{ status: "asc" }, { student: { studentNo: "asc" } }], include: { student: { select: { id: true, studentNo: true, firstName: true, lastName: true } }, examination: { include: { course: { select: { code: true } } } } } }),
      db.examRegistration.count({ where }),
      db.examination.findMany({ where: { sessionId: session.id }, include: { course: { select: { code: true } } }, orderBy: { course: { code: "asc" } } }),
    ]);
    const manage = can(ctx, "examreg.manage");
    const feeRequired = (await getSetting("examination")).examFeeRequired;
    return (
      <Section
        title="Candidates"
        actions={manage && (
          <>
            <ActionButton size="xs" run={generateRegistrationsAction.bind(null, session.id)} label="Generate / refresh eligibility" />
            {feeRequired && can(ctx, "invoice.manage") && <ActionButton size="xs" run={createExamFeeInvoicesAction.bind(null, session.id)} label="Raise exam fee invoices" confirmText="Raise one examination-fee invoice per candidate whose fee is pending? Hall tickets are issued once the invoice is paid." />}
            <ActionButton size="xs" variant="default" run={issueHallTicketsAction.bind(null, session.id)} label="Issue hall tickets" confirmText="Issue hall tickets to every eligible candidate whose fees are settled? Students are notified." />
          </>
        )}
        bodyClassName="p-0"
      >
        <form className="flex flex-wrap gap-2 border-b px-5 py-3">
          <input type="hidden" name="session" value={session.id} />
          <select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="h-8 rounded-lg border bg-card px-2 text-[13px]"><option value="">Any status</option>{Object.entries(EXAM_REG_STATUS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select>
          <select name="exam" defaultValue={sp.exam ?? ""} aria-label="Paper" className="h-8 rounded-lg border bg-card px-2 text-[13px]"><option value="">All papers</option>{exams.map((e) => <option key={e.id} value={e.id}>{e.course.code}</option>)}</select>
          <button className="h-8 rounded-lg border px-3 text-[13px] hover:bg-muted">Filter</button>
        </form>
        {rows.length === 0 ? <div className="p-6"><EmptyState icon={Ticket} title="No candidates yet" description={manage ? "Generate eligibility from class registrations and attendance." : undefined} /></div> : (
          <DataTable head={[{ label: "Student" }, { label: "Paper" }, { label: "Attendance", className: "text-right" }, { label: "Status" }, { label: "Hall ticket" }, { label: "" }]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td><Link href={`/students/${r.student.id}`} className="hover:text-primary">{r.student.firstName} {r.student.lastName}</Link><div className="font-mono text-[11px] text-muted-foreground">{r.student.studentNo}</div></Td>
                <Td className="text-xs">{r.examination.course.code}{r.attemptType !== "REGULAR" && <span className="text-muted-foreground"> · {r.attemptType.toLowerCase()}</span>}</Td>
                <Td className="text-right tabular">{r.attendancePct ?? "—"}{r.attendancePct !== null && "%"}</Td>
                <Td><StatusBadge meta={EXAM_REG_STATUS[r.status]} />{r.reasons.length > 0 && <div className="mt-0.5 text-[11px] text-muted-foreground">{r.reasons.join("; ")}</div>}</Td>
                <Td className="font-mono text-xs">{r.hallTicketNo ?? "—"}</Td>
                <Td>{manage && ["ELIGIBLE", "NOT_ELIGIBLE", "CONDONATION_PENDING"].includes(r.status) && <EligibilityControls registrationId={r.id} eligible={r.status === "ELIGIBLE"} />}</Td>
              </tr>
            ))}
          </DataTable>
        )}
        <Pagination page={page} pageSize={pageSize} total={total} hrefFor={(p) => `/exam-ops${qs({ session: session.id, status: sp.status, exam: sp.exam }, { page: p })}`} />
      </Section>
    );
  }

  async function sittings() {
    const schedules = await db.examSchedule.findMany({ where: { examination: { sessionId: session.id } }, include: { examination: { include: { course: { select: { code: true } } } } }, orderBy: [{ date: "asc" }, { slot: "asc" }] });
    const map = new Map<string, { date: Date; slot: "FN" | "AN"; papers: string[]; examIds: string[]; startsAt: Date }>();
    for (const s of schedules) {
      const k = `${dayKey(s.date)}|${s.slot}`;
      const e = map.get(k) ?? map.set(k, { date: s.date, slot: s.slot, papers: [], examIds: [], startsAt: s.startsAt }).get(k)!;
      e.papers.push(s.examination.course.code);
      e.examIds.push(s.examinationId);
    }
    return [...map.values()];
  }

  async function Seating() {
    const inst = await getInstitution();
    const list = await sittings();
    const rooms = await db.room.findMany({ where: { isActive: true, OR: [{ examCapacity: { gt: 0 } }, { type: "EXAM_HALL" }] }, orderBy: [{ type: "desc" }, { code: "asc" }] });
    const manage = can(ctx, "seating.manage");
    if (!list.length) return <Section title="Seating"><p className="text-sm text-muted-foreground">No papers are scheduled in this session yet.</p></Section>;
    return (
      <div className="space-y-4">
        {await Promise.all(list.map(async (s) => {
          const [candidates, seats] = await Promise.all([
            db.examRegistration.count({ where: { examinationId: { in: s.examIds }, status: "REGISTERED" } }),
            db.examSeat.groupBy({ by: ["roomId"], where: { date: s.date, slot: s.slot, registration: { sessionId: session.id } }, _count: { _all: true } }),
          ]);
          const seated = seats.reduce((a, x) => a + x._count._all, 0);
          return (
            <Section key={`${dayKey(s.date)}${s.slot}`} title={`${fmtDate(s.date)} · ${s.slot === "FN" ? "Forenoon" : "Afternoon"} (${fmtTime(s.startsAt, inst.timezone)})`} description={`${s.papers.join(", ")} · ${candidates} candidate(s) · ${seated} seated`}>
              {seats.length > 0 && (
                <ul className="mb-3 flex flex-wrap gap-2 text-xs">
                  {seats.map((x) => <li key={x.roomId} className="rounded-lg border px-2 py-1">{rooms.find((r) => r.id === x.roomId)?.code ?? "Room"}: {x._count._all}</li>)}
                  <li><Link className="text-primary hover:underline" href={`/exam-ops/seating?session=${session.id}&date=${dayKey(s.date)}&slot=${s.slot}`}>Seating plan →</Link></li>
                </ul>
              )}
              {manage && candidates > 0 && <AllocateForm sessionId={session.id} date={dayKey(s.date)} slot={s.slot} rooms={rooms.map((r) => ({ id: r.id, label: r.code, seats: r.examCapacity ?? Math.floor(r.capacity / 2) }))} />}
              {candidates === 0 && <p className="text-xs text-muted-foreground">No hall tickets issued for this sitting yet.</p>}
            </Section>
          );
        }))}
      </div>
    );
  }

  async function Duties() {
    const list = await sittings();
    const [duties, rooms] = await Promise.all([
      db.invigilationDuty.findMany({ where: { sessionId: session.id }, include: { user: { select: { name: true, designation: true } }, room: { select: { code: true } } }, orderBy: [{ date: "asc" }, { slot: "asc" }, { room: { code: "asc" } }] }),
      db.room.findMany({ where: { isActive: true, OR: [{ examCapacity: { gt: 0 } }, { type: "EXAM_HALL" }] }, orderBy: { code: "asc" } }),
    ]);
    const manage = can(ctx, "seating.manage");
    return (
      <div className="space-y-6">
        {manage && list.length > 0 && <Section title="Assign a duty"><DutyForm sessionId={session.id} sittings={list.map((s) => ({ date: dayKey(s.date), slot: s.slot, label: `${fmtDate(s.date)} ${s.slot}` }))} rooms={rooms.map((r) => ({ id: r.id, label: r.code }))} /></Section>}
        <Section title="Duty roster" bodyClassName="p-0">
          {duties.length === 0 ? <p className="px-5 py-4 text-sm text-muted-foreground">No duties assigned.</p> : (
            <DataTable head={[{ label: "Sitting" }, { label: "Room" }, { label: "Staff" }, { label: "Role" }, { label: "" }]}>
              {duties.map((d) => (
                <tr key={d.id}>
                  <Td className="text-xs whitespace-nowrap">{fmtDate(d.date)} {d.slot}</Td>
                  <Td className="text-xs">{d.room.code}</Td>
                  <Td>{d.user.name}<div className="text-[11px] text-muted-foreground">{d.user.designation}</div></Td>
                  <Td className="text-xs">{d.role.replace("_", " ").toLowerCase()}</Td>
                  <Td className="text-right">{manage && <RemoveDutyButton id={d.id} />}</Td>
                </tr>
              ))}
            </DataTable>
          )}
        </Section>
      </div>
    );
  }

  async function Scripts() {
    const exams = await db.examination.findMany({ where: { sessionId: session.id }, include: { course: { select: { code: true, title: true } } }, orderBy: { course: { code: "asc" } } });
    const valuerIds = await usersWithPermission("valuation.perform");
    const valuers = await db.user.findMany({ where: { id: { in: valuerIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
    const { doubleValuation } = await getSetting("examination");
    const manage = can(ctx, "valuation.manage");
    const rows = await Promise.all(exams.map(async (e) => {
      const [confirmed, byStatus] = await Promise.all([
        db.examRegistration.count({ where: { examinationId: e.id, status: "REGISTERED" } }),
        db.answerScript.groupBy({ by: ["status"], where: { examinationId: e.id }, _count: { _all: true } }),
      ]);
      const n = (s: string) => byStatus.find((x) => x.status === s)?._count._all ?? 0;
      const coded = byStatus.reduce((a, x) => a + x._count._all, 0);
      return { e, confirmed, coded, final: n("FINAL"), third: n("THIRD_VALUATION"), pending: n("PENDING") + n("IN_VALUATION") + n("VALUED") };
    }));
    const active = rows.filter((r) => r.confirmed > 0);
    return (
      <Section title="Answer scripts" description={`Valuers see dummy numbers only. ${doubleValuation ? "Double valuation is on; large differences go to a third valuer." : "Single valuation."}`} bodyClassName="p-0">
        {active.length === 0 ? <p className="px-5 py-4 text-sm text-muted-foreground">No hall tickets issued yet.</p> : (
          <DataTable head={[{ label: "Paper" }, { label: "Scripts" }, { label: "Final", className: "text-right" }, { label: "In valuation", className: "text-right" }, { label: "Third", className: "text-right" }, { label: "" }]}>
            {active.map(({ e, confirmed, coded, final, third, pending }) => (
              <tr key={e.id}>
                <Td><Link href={`/exam-ops/scripts/${e.id}`} className="hover:text-primary"><span className="font-mono text-xs text-muted-foreground">{e.course.code}</span> {e.course.title}</Link></Td>
                <Td className="text-xs">{coded} of {confirmed} coded</Td>
                <Td className="text-right tabular">{final}</Td>
                <Td className="text-right tabular">{pending}</Td>
                <Td className="text-right tabular">{third}</Td>
                <Td className="min-w-72">
                  {manage && coded < confirmed && <ActionButton size="xs" run={codeScriptsAction.bind(null, e.id)} label="Code scripts" />}
                  {manage && coded > 0 && final < coded && <AssignValuersForm examinationId={e.id} valuers={valuers.map((v) => ({ id: v.id, label: v.name }))} rounds={[...(pending ? [1 as const] : []), ...(pending && doubleValuation ? [2 as const] : []), ...(third ? [3 as const] : [])]} />}
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
    );
  }
}
