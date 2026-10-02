import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { ActionButton } from "@/features/academic-ops/controls";
import { closeGrievanceAction } from "@/features/campuslife/actions";
import { GrievanceControls } from "@/features/campuslife/controls";
import { fmtDateTime } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { loadGrievance } from "@/server/services/grievances";
import { getSetting } from "@/server/services/settings";

export const metadata: Metadata = { title: "Grievance" };

const LEVEL: Record<string, string> = { DEPARTMENT: "Department committee", INSTITUTION: "Institution committee", OMBUDSPERSON: "Ombudsperson" };
const ACTION: Record<string, string> = { SUBMITTED: "Submitted", STUDENT_NOTE: "Complainant", COMMITTEE_NOTE: "Committee", RESOLVED: "Decision", APPEALED: "Appealed", ESCALATED: "Escalated", CLOSED: "Closed" };

export default async function GrievancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth();
  const data = await loadGrievance(ctx, id).catch(() => null);
  if (!data) notFound();
  const { grievance: g, own, handler } = data;
  const { appealDays } = await getSetting("campus");
  const canAppeal = own && g.status === "RESOLVED" && g.level !== "OMBUDSPERSON" && !!g.resolvedAt && new Date().getTime() - g.resolvedAt.getTime() <= appealDays * 86_400_000;
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Grievances", href: "/grievances" }, { label: g.number }]}
        eyebrow={<span className="font-mono">{g.number}</span>}
        title={g.subject}
        actions={own && g.status !== "CLOSED" ? <ActionButton label={g.status === "RESOLVED" ? "Accept and close" : "Withdraw"} confirmText={g.status === "RESOLVED" ? "Accept the decision and close the grievance?" : "Withdraw this grievance?"} run={closeGrievanceAction.bind(null, g.id)} /> : undefined}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="Grievance"><p className="whitespace-pre-wrap text-sm">{g.description}</p></Section>
          {g.resolution && <Section title="Decision"><p className="whitespace-pre-wrap text-sm">{g.resolution}</p></Section>}
          <Section title="History">
            <ol className="space-y-3">
              {g.actions.map((a) => (
                <li key={a.id} className="border-l-2 pl-3">
                  <p className="text-xs text-muted-foreground">{ACTION[a.action] ?? a.action} · {fmtDateTime(a.createdAt)}</p>
                  {a.note && <p className="whitespace-pre-wrap text-sm">{a.note}</p>}
                </li>
              ))}
            </ol>
            {(own || handler) && <div className="mt-5 border-t pt-4"><GrievanceControls id={g.id} handler={handler} own={own} status={g.status} canAppeal={canAppeal} /></div>}
          </Section>
        </div>
        <Section title="Details">
          <KeyValue items={[
            ["Raised by", g.anonymous && !own ? "Anonymous" : g.raisedBy ? `${g.raisedBy.name}${g.student ? ` (${g.student.studentNo})` : ""}` : "—"],
            ["About", g.category.toLowerCase()],
            ["Now with", LEVEL[g.level]],
            ["Status", g.status.toLowerCase().replace("_", " ")],
            ["Respond by", fmtDateTime(g.dueAt)],
            ["Raised", fmtDateTime(g.createdAt)],
          ]} />
        </Section>
      </div>
    </div>
  );
}
