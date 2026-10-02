import Link from "next/link";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { RichContent } from "@/components/app/rich-content";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { raiseDataRequestAction, reportBreachAction } from "@/features/compliance/actions";
import { ConsentButtons } from "@/features/compliance/controls";
import { DATA_REQUEST_STATUS, DATA_REQUEST_TYPE } from "@/features/compliance/labels";
import { fmtDate } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { myNotices, wardNotices } from "@/server/services/privacy";
import { getSetting } from "@/server/services/settings";

export const metadata: Metadata = { title: "Privacy & consent" };

export default async function MyPrivacyPage() {
  const ctx = await requirePageAuth();
  const [notices, wards, requests, cfg] = await Promise.all([
    myNotices(ctx),
    wardNotices(ctx),
    db.dataRequest.findMany({ where: { userId: ctx.user.id }, orderBy: { createdAt: "desc" } }),
    getSetting("privacy"),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Privacy & consent"
        description={`How the institution uses your personal data, the choices you have made, and your rights under the Digital Personal Data Protection Act 2023. Data Protection Officer: ${cfg.dpoName} · ${cfg.dpoEmail}.`}
        actions={
          <FormDialog title="Request" action={raiseDataRequestAction} submitLabel="Send request" initial={{ type: "ACCESS" }} trigger={<Button size="sm"><Plus /> Make a request</Button>}
            fields={[{ name: "type", label: "I want to", type: "select", options: Object.entries(DATA_REQUEST_TYPE).map(([value, label]) => ({ value, label })) }, { name: "details", label: "Details", type: "textarea", placeholder: "What data, what should change, or what your concern is" }]} />
        }
      />
      <Section title="Notices and choices">
        <div className="divide-y">
          {notices.length === 0 && <p className="text-sm text-muted-foreground">There are no privacy notices for you yet.</p>}
          {notices.map(({ notice: n, decision, decidedAt }) => (
            <details key={n.id} className="group py-3 first:pt-0 last:pb-0">
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
                <span><span className="font-medium">{n.title}</span> <span className="text-xs text-muted-foreground">v{n.version} · {n.required ? "required" : "your choice"}{decidedAt ? ` · decided ${fmtDate(decidedAt)}` : ""}</span><span className="block text-xs text-muted-foreground">{n.purpose}</span></span>
                <ConsentButtons noticeId={n.id} decision={decision} required={n.required} />
              </summary>
              <div className="mt-3 rounded-lg bg-muted/40 p-3 text-sm"><RichContent body={n.body} /></div>
            </details>
          ))}
        </div>
      </Section>
      {wards.map((w) => (
        <Section key={w.ward.id} title={`Choices for ${w.ward.firstName} ${w.ward.lastName}`} description="Your ward is under 18, so you decide the optional purposes on their behalf.">
          <div className="divide-y">
            {w.notices.map(({ notice: n, decision }) => (
              <div key={n.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <span><span className="font-medium">{n.title}</span><span className="block text-xs text-muted-foreground">{n.purpose}</span></span>
                <ConsentButtons noticeId={n.id} decision={decision} required={false} studentId={w.ward.id} />
              </div>
            ))}
          </div>
        </Section>
      ))}
      <Section title="My requests" bodyClassName="p-0">
        <DataTable head={[{ label: "Request" }, { label: "Raised" }, { label: "Respond by" }, { label: "Status" }]} empty="You have not made any requests.">
          {requests.map((r) => (
            <tr key={r.id}>
              <Td><Link className="font-medium hover:text-primary" href={`/privacy/requests/${r.id}`}>{DATA_REQUEST_TYPE[r.type]}</Link> <span className="font-mono text-xs text-muted-foreground">{r.number}</span></Td>
              <Td className="text-xs">{fmtDate(r.createdAt)}</Td>
              <Td className="text-xs">{fmtDate(r.dueAt)}</Td>
              <Td><StatusBadge meta={DATA_REQUEST_STATUS[r.status]} /></Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      <Section title="Report a suspected data breach" description="If you think personal data was lost, exposed or sent to the wrong person, tell the Data Protection Officer at once.">
        <FormDialog title="Suspected breach" action={reportBreachAction} submitLabel="Report" columns={2} initial={{ severity: "MEDIUM", affectedCount: 0 }} trigger={<Button size="sm" variant="outline">Report a breach</Button>}
          fields={[
            { name: "title", label: "What happened, in a line", type: "text", wide: true },
            { name: "detectedAt", label: "When you noticed it", type: "datetime-local" },
            { name: "severity", label: "How serious", type: "select", options: ["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() })) },
            { name: "dataCategories", label: "What data", type: "text", wide: true },
            { name: "affectedCount", label: "How many people (estimate)", type: "number", min: 0 },
            { name: "description", label: "Details", type: "textarea" },
          ]} />
      </Section>
    </div>
  );
}
