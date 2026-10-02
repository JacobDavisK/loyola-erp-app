import { Award, Plus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog, type FormField } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { PromptButton } from "@/features/finance/controls";
import { awardBadgeAction, revokeBadgeAwardAction, saveBadgeAction } from "@/features/wallet/actions";
import { fmtDate } from "@/lib/format";
import { requirePageAuth, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Badges & micro-credentials" };

const FIELDS: FormField[] = [
  { name: "name", label: "Name", type: "text", wide: true },
  { name: "kind", label: "Kind", type: "select", options: [{ value: "BADGE", label: "Skill badge" }, { value: "MICRO_CREDENTIAL", label: "Micro-credential (stackable, with credits)" }, { value: "CERTIFICATE_OF_PARTICIPATION", label: "Participation certificate" }] },
  { name: "credits", label: "Credits", type: "number", optional: true, step: 0.5 },
  { name: "hours", label: "Hours", type: "number", optional: true },
  { name: "skills", label: "Skills (comma-separated)", type: "text", optional: true, wide: true },
  { name: "description", label: "Description", type: "textarea" },
  { name: "criteria", label: "Criteria (how it is earned)", type: "textarea" },
  { name: "active", label: "Can be awarded", type: "checkbox" },
];

export default async function BadgesPage() {
  const ctx = await requirePageAuth("badge.manage");
  const scope = scopeOf(ctx, "badge.manage");
  const [badges, awards] = await Promise.all([
    db.badgeClass.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], include: { _count: { select: { awards: { where: { revokedAt: null } } } } } }),
    db.badgeAward.findMany({ where: scope === null ? {} : { student: { departmentId: { in: scope } } }, orderBy: { awardedAt: "desc" }, take: 100, include: { badge: { select: { name: true } }, student: { select: { studentNo: true, firstName: true, lastName: true } } } }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Badges & micro-credentials"
        description="Recognise skills, short courses and participation. Every award is issued at once as a signed, verifiable credential in the student's wallet."
        actions={<FormDialog title="Badge" columns={2} fields={FIELDS} action={saveBadgeAction} initial={{ kind: "BADGE", active: true }} trigger={<Button size="sm"><Plus /> New badge</Button>} />}
      />
      <Section title="Badges" bodyClassName="p-0">
        <DataTable head={[{ label: "Badge" }, { label: "Kind" }, { label: "Awarded" }, { label: "" }]} empty="No badges yet.">
          {badges.map((b) => (
            <tr key={b.id} className={b.active ? undefined : "opacity-60"}>
              <Td><div className="font-medium">{b.name}</div><div className="text-xs text-muted-foreground">{b.skills.join(" · ")}{b.credits ? ` · ${b.credits} credits` : ""}{b.hours ? ` · ${b.hours} h` : ""}</div></Td>
              <Td className="text-xs">{b.kind === "MICRO_CREDENTIAL" ? "Micro-credential" : b.kind === "CERTIFICATE_OF_PARTICIPATION" ? "Participation" : "Badge"}</Td>
              <Td>{b._count.awards}</Td>
              <Td className="whitespace-nowrap text-right">
                {b.active && <FormDialog title="Award" action={awardBadgeAction.bind(null, b.id)} submitLabel="Award" trigger={<Button size="xs" variant="outline"><Award /> Award</Button>}
                  fields={[{ name: "studentNos", label: "Student numbers (separated by spaces, commas or new lines)", type: "textarea" }, { name: "evidence", label: "Evidence (optional)", type: "text", optional: true }]} />}
                <FormDialog title="Badge" columns={2} id={b.id} fields={FIELDS} action={saveBadgeAction} initial={{ name: b.name, kind: b.kind, credits: b.credits, hours: b.hours, skills: b.skills.join(", "), description: b.description, criteria: b.criteria, active: b.active }} />
              </Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      <Section title="Recent awards" bodyClassName="p-0">
        <DataTable head={[{ label: "Student" }, { label: "Badge" }, { label: "Awarded" }, { label: "" }]} empty="No awards yet.">
          {awards.map((a) => (
            <tr key={a.id} className={a.revokedAt ? "opacity-60" : undefined}>
              <Td>{a.student.firstName} {a.student.lastName} <span className="font-mono text-xs text-muted-foreground">{a.student.studentNo}</span></Td>
              <Td>{a.badge.name}</Td>
              <Td className="text-xs">{fmtDate(a.awardedAt)}{a.revokedAt ? ` · revoked: ${a.revokeReason}` : ""}</Td>
              <Td className="text-right">{!a.revokedAt && <PromptButton label="Revoke" destructive question="Why is this award being revoked?" action={revokeBadgeAwardAction.bind(null, a.id)} />}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
