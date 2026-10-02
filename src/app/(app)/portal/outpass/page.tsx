import { DoorOpen, Plus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { EmptyState, PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/features/academic-ops/controls";
import { applyOutpassAction, cancelOutpassAction } from "@/features/operations/actions";
import { outpassFields } from "@/features/operations/fields";
import { fmtDateTimeZoned } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { getInstitution } from "@/server/services/directory";
import { getT } from "@/server/i18n";

export const metadata: Metadata = { title: "Out-pass" };

const STATUS: Record<string, string> = { REQUESTED: "Waiting for the warden", APPROVED: "Approved — show this at the gate", REJECTED: "Refused", OUT: "Out", RETURNED: "Returned", CANCELLED: "Cancelled" };

export default async function OutpassPage() {
  const ctx = await requirePageAuth("enrollment.self");
  const t = await getT();
  const studentId = ctx.subject.studentId;
  const { timezone } = await getInstitution();
  const [res, rows] = studentId
    ? await Promise.all([
        db.hostelAllocation.findFirst({ where: { studentId, vacatedAt: null }, include: { room: { include: { hostel: true } } } }),
        db.outpass.findMany({ where: { studentId }, orderBy: { createdAt: "desc" }, take: 50 }),
      ])
    : [null, []];
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Out-pass")}
        description="Hostel residents apply here to leave the campus overnight or for the weekend. Your warden approves it and your parent or guardian gets an SMS. Show the approved pass at the gate when you leave and when you return."
        actions={res ? <FormDialog title="Out-pass" action={applyOutpassAction} fields={outpassFields} columns={2} submitLabel="Apply" trigger={<Button size="sm"><Plus /> {t("Apply")}</Button>} /> : undefined}
      />
      {!res ? (
        <EmptyState icon={DoorOpen} title={t("Not a hostel resident")} description="Out-passes are for students staying in a hostel." />
      ) : (
        <Section title={`${res.room.hostel.name}, room ${res.room.number}`} bodyClassName="p-0">
          <DataTable head={[{ label: "Going to" }, { label: "Leave" }, { label: "Return by" }, { label: "Status" }, { label: "" }]} empty="No out-passes yet.">
            {rows.map((o) => (
              <tr key={o.id}>
                <Td>{o.destination}<div className="text-[11px] text-muted-foreground">{o.reason}</div></Td>
                <Td className="text-xs">{fmtDateTimeZoned(o.leaveAt, timezone)}</Td>
                <Td className="text-xs">{fmtDateTimeZoned(o.returnBy, timezone)}</Td>
                <Td className="text-xs">{STATUS[o.status]}{o.late ? " (late)" : ""}{o.decisionNote && <div className="text-muted-foreground">{o.decisionNote}</div>}</Td>
                <Td className="text-right">{["REQUESTED", "APPROVED"].includes(o.status) && <ActionButton label="Cancel" size="xs" variant="ghost" run={cancelOutpassAction.bind(null, o.id)} confirmText="Cancel this out-pass?" />}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
    </div>
  );
}
