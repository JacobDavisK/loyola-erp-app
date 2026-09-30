import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionButton } from "@/features/academic-ops/controls";
import { applyToDriveAction, withdrawPlacementAction } from "@/features/campus/actions";
import { PLACEMENT_STATUS } from "@/features/campus/labels";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { fmtDateTime } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { placementFacts } from "@/server/services/placements";
import { getSetting } from "@/server/services/settings";
import { checkDriveEligibility, driveEligibilitySchema } from "@/lib/domain/campus";

export const metadata: Metadata = { title: "Placements" };

export default async function StudentPlacementsPage() {
  const ctx = await requirePageAuth("self.portal");
  const studentId = ctx.subject.studentId;
  if (!studentId) redirect("/portal");
  const now = new Date();
  const [drives, mine, inst] = await Promise.all([
    db.placementDrive.findMany({ where: { status: "OPEN", applyBy: { gte: now } }, orderBy: { applyBy: "asc" }, include: { company: true } }),
    db.placementApplication.findMany({ where: { studentId }, orderBy: { createdAt: "desc" }, include: { drive: { include: { company: { select: { name: true } } } } } }),
    db.institution.findFirstOrThrow({ select: { currency: true, locale: true } }),
  ]);
  // The student's facts are computed once and checked against every open drive.
  const [facts, { oneOfferPolicy }] = await Promise.all([placementFacts(studentId), getSetting("placements")]);
  const checks = drives.map((d) => checkDriveEligibility(driveEligibilitySchema.catch({}).parse(d.eligibility), facts, oneOfferPolicy));
  const applied = new Map(mine.map((a) => [a.driveId, a]));
  const fmt = (x: { toString(): string } | null) => (x === null ? "—" : formatMoney(toMinor(x), inst.currency, inst.locale));
  return (
    <div className="space-y-6">
      <PageHeader title="Placements" breadcrumbs={[{ label: "My studies" }, { label: "Placements" }]} description="Open recruitment drives. Eligibility is checked against your academic record when you apply." />
      <Section title="Open drives" bodyClassName="p-0">
        <DataTable head={[{ label: "Company" }, { label: "Role" }, { label: "CTC", className: "text-right" }, { label: "Apply by" }, { label: "Eligibility" }, { label: "" }]} empty="No drives are open right now.">
          {drives.map((d, i) => {
            const a = applied.get(d.id);
            const e = checks[i];
            return (
              <tr key={d.id}>
                <Td><div className="font-medium">{d.company.name}</div><div className="text-xs text-muted-foreground">{d.title}</div></Td>
                <Td className="text-xs">{d.role}{d.location ? ` · ${d.location}` : ""}</Td>
                <Td className="text-right tabular">{fmt(d.ctc)}</Td>
                <Td className="text-xs">{fmtDateTime(d.applyBy)}</Td>
                <Td className={e.eligible ? "text-xs text-tone-success" : "text-xs text-tone-danger"}>{e.eligible ? "Eligible" : e.reasons.join("; ")}</Td>
                <Td className="text-right">{a && a.status !== "WITHDRAWN" ? <StatusBadge meta={PLACEMENT_STATUS[a.status]} /> : e.eligible && <ActionButton size="xs" label="Apply" variant="default" run={applyToDriveAction.bind(null, d.id)} confirmText={`Apply to ${d.company.name} (${d.role})?`} />}</Td>
              </tr>
            );
          })}
        </DataTable>
      </Section>
      <Section title="My applications" bodyClassName="p-0">
        <DataTable head={[{ label: "Company" }, { label: "Role" }, { label: "Status" }, { label: "Offer", className: "text-right" }, { label: "" }]} empty="You have not applied to any drive.">
          {mine.map((a) => (
            <tr key={a.id}>
              <Td>{a.drive.company.name}</Td>
              <Td className="text-xs">{a.drive.role}</Td>
              <Td><StatusBadge meta={PLACEMENT_STATUS[a.status]} /></Td>
              <Td className="text-right tabular">{fmt(a.offerCtc)}</Td>
              <Td className="text-right">{(a.status === "APPLIED" || a.status === "SHORTLISTED") && <ActionButton size="xs" variant="ghost" label="Withdraw" run={withdrawPlacementAction.bind(null, a.id)} confirmText="Withdraw this application?" />}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
