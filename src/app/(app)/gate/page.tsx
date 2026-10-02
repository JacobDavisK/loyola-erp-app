import { KeyRound, LogIn } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, LinkTabs, Td } from "@/components/app/list";
import { PageHeader, Section, StatCard } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/features/academic-ops/controls";
import { checkInVisitorAction, checkOutVisitorAction, gateMoveAction } from "@/features/operations/actions";
import { DecideOutpass } from "@/features/operations/controls";
import { passCodeFields, walkInFields } from "@/features/operations/fields";
import { fmtDateTimeZoned } from "@/lib/format";
import { cn } from "@/lib/utils";
import { can, isSuperAdmin, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { getInstitution } from "@/server/services/directory";
import { outpassWhere } from "@/server/services/gate";

export const metadata: Metadata = { title: "Gate & out-passes" };

const STATUS: Record<string, string> = { REQUESTED: "awaiting warden", APPROVED: "approved", REJECTED: "refused", OUT: "out", RETURNED: "returned", CANCELLED: "cancelled" };

export default async function GatePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageAuth(["gate.manage", "hostel.manage"]);
  const gate = can(ctx, "gate.manage");
  const view = (await searchParams).view ?? (gate ? "visitors" : "outpasses");
  const { timezone } = await getInstitution();
  const now = new Date();
  const dayStart = new Date(now.getTime() - 18 * 3_600_000);
  const where = await outpassWhere(ctx).catch(() => null);
  const [onCampus, today, expected, staff, outpasses] = await Promise.all([
    gate ? db.visitor.findMany({ where: { checkedInAt: { not: null }, checkedOutAt: null }, orderBy: { checkedInAt: "desc" } }) : [],
    gate ? db.visitor.count({ where: { checkedInAt: { gte: dayStart } } }) : 0,
    gate ? db.visitor.findMany({ where: { checkedInAt: null, expectedAt: { gte: dayStart, lte: new Date(now.getTime() + 24 * 3_600_000) } }, orderBy: { expectedAt: "asc" } }) : [],
    gate ? db.user.findMany({ where: { userType: "STAFF", status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true }, take: 1000 }) : [],
    where ? db.outpass.findMany({ where: { ...where, OR: [{ status: { in: ["REQUESTED", "APPROVED", "OUT"] } }, { createdAt: { gte: new Date(now.getTime() - 14 * 86_400_000) } }] }, include: { student: { select: { studentNo: true, firstName: true, lastName: true } } }, orderBy: [{ status: "asc" }, { leaveAt: "asc" }], take: 300 }) : [],
  ]);
  const wardenOf = await db.hostel.count({ where: { wardenId: ctx.user.id } });
  const overdue = outpasses.filter((o) => o.status === "OUT" && o.returnBy < now);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Gate & out-passes"
        description="Visitors are logged in and out at the gate — with a pass code if their host registered them. Hostel students leave on an out-pass approved by their warden; the guardian is told by SMS, and a return after the deadline is flagged."
        actions={gate ? (
          <div className="flex flex-wrap gap-2">
            <FormDialog title="Pass check-in" action={checkInVisitorAction} fields={passCodeFields} submitLabel="Check in" trigger={<Button size="sm"><KeyRound /> Pass code</Button>} />
            <FormDialog title="Walk-in visitor" action={checkInVisitorAction} fields={walkInFields(staff.map((s) => ({ id: s.id, label: s.name })))} columns={2} submitLabel="Check in" trigger={<Button size="sm" variant="outline"><LogIn /> Walk-in</Button>} />
          </div>
        ) : undefined}
      />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
        {gate && <StatCard label="Visitors on campus" value={onCampus.length} />}
        {gate && <StatCard label="Visitors today" value={today} />}
        <StatCard label="Students out" value={outpasses.filter((o) => o.status === "OUT").length} />
        <StatCard label="Overdue returns" value={overdue.length} tone={overdue.length ? "danger" : undefined} />
      </div>
      {gate && <LinkTabs active={view} tabs={[{ key: "visitors", label: "Visitors", href: "/gate" }, { key: "outpasses", label: "Out-passes", href: "/gate?view=outpasses" }]} />}
      {view === "visitors" && gate && (
        <>
          <Section title="On campus now" bodyClassName="p-0">
            <DataTable head={[{ label: "Visitor" }, { label: "To see" }, { label: "Purpose" }, { label: "In since" }, { label: "" }]} empty="No visitors on campus.">
              {onCampus.map((v) => (
                <tr key={v.id}>
                  <Td>{v.name}<div className="text-[11px] text-muted-foreground">{v.phone}{v.vehicleNo ? ` · ${v.vehicleNo}` : ""}</div></Td>
                  <Td className="text-xs">{v.hostName ?? "—"}</Td>
                  <Td className="text-xs">{v.purpose}</Td>
                  <Td className="text-xs">{fmtDateTimeZoned(v.checkedInAt, timezone)}</Td>
                  <Td className="text-right"><ActionButton label="Check out" size="xs" run={checkOutVisitorAction.bind(null, v.id)} /></Td>
                </tr>
              ))}
            </DataTable>
          </Section>
          <Section title="Expected" bodyClassName="p-0">
            <DataTable head={[{ label: "Visitor" }, { label: "Host" }, { label: "Expected" }]} empty="Nobody pre-registered.">
              {expected.map((v) => <tr key={v.id}><Td>{v.name}</Td><Td className="text-xs">{v.hostName}</Td><Td className="text-xs">{fmtDateTimeZoned(v.expectedAt, timezone)}</Td></tr>)}
            </DataTable>
          </Section>
        </>
      )}
      {view === "outpasses" && (
        <Section title="Out-passes" bodyClassName="p-0">
          <DataTable head={[{ label: "Student" }, { label: "Going to" }, { label: "Leave" }, { label: "Return by" }, { label: "Status" }, { label: "" }]} empty="No out-passes.">
            {outpasses.map((o) => {
              const late = (o.status === "OUT" && o.returnBy < now) || o.late;
              return (
                <tr key={o.id}>
                  <Td>{o.student.firstName} {o.student.lastName}<div className="font-mono text-[11px] text-muted-foreground">{o.student.studentNo}</div></Td>
                  <Td className="text-xs">{o.destination}<div className="text-muted-foreground">{o.reason}</div></Td>
                  <Td className="text-xs">{fmtDateTimeZoned(o.outAt ?? o.leaveAt, timezone)}</Td>
                  <Td className={cn("text-xs", late && "font-medium text-tone-danger")}>{fmtDateTimeZoned(o.inAt ?? o.returnBy, timezone)}{o.late ? " (late)" : ""}</Td>
                  <Td className="text-xs">{STATUS[o.status]}{o.guardianNotified ? " · guardian told" : ""}</Td>
                  <Td className="text-right">
                    {o.status === "REQUESTED" && (wardenOf > 0 || isSuperAdmin(ctx)) && <DecideOutpass id={o.id} />}
                    {gate && o.status === "APPROVED" && <ActionButton label="Mark out" size="xs" run={gateMoveAction.bind(null, o.id)} />}
                    {gate && o.status === "OUT" && <ActionButton label="Mark returned" size="xs" variant="default" run={gateMoveAction.bind(null, o.id)} />}
                  </Td>
                </tr>
              );
            })}
          </DataTable>
        </Section>
      )}
    </div>
  );
}
