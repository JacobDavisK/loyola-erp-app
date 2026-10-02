import Link from "next/link";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, LinkTabs, Td } from "@/components/app/list";
import { PageHeader, Section, StatCard } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/features/academic-ops/controls";
import { publishNoticeAction, reportBreachAction, retireNoticeAction, saveRetentionRuleAction } from "@/features/compliance/actions";
import { BreachControls } from "@/features/compliance/controls";
import { BREACH_STATUS, DATA_REQUEST_STATUS, DATA_REQUEST_TYPE } from "@/features/compliance/labels";
import { addHours } from "@/lib/domain/compliance";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { privacyOverview, RETENTION_DATASETS } from "@/server/services/privacy";
import { getSetting } from "@/server/services/settings";

export const metadata: Metadata = { title: "Data protection" };

const NOTICE_FIELDS = [
  { name: "key", label: "Key (same key = new version)", type: "text" as const, placeholder: "student.records" },
  { name: "audience", label: "Shown to", type: "select" as const, options: [{ value: "ALL", label: "Everyone" }, { value: "STUDENT", label: "Students" }, { value: "STAFF", label: "Staff" }, { value: "GUARDIAN", label: "Guardians" }] },
  { name: "title", label: "Title", type: "text" as const, wide: true },
  { name: "purpose", label: "Purpose (one line)", type: "text" as const, wide: true },
  { name: "body", label: "Notice text (what data, why, how long, rights, DPO contact)", type: "textarea" as const },
  { name: "required", label: "Required to use the system (acknowledgement only; cannot be refused)", type: "checkbox" as const },
];

export default async function PrivacyPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePageAuth("privacy.manage");
  const { tab = "requests" } = await searchParams;
  const [o, cfg] = await Promise.all([privacyOverview(), getSetting("privacy")]);
  const now = new Date();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Data protection (DPDP Act 2023)"
        description={`Privacy notices and consent, requests from data principals (${cfg.requestDays}-day response target), the personal-data breach register (Board notification within ${cfg.breachNotifyHours} hours) and retention. Data Protection Officer: ${cfg.dpoName} · ${cfg.dpoEmail}.`}
      />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
        <StatCard label="Open requests" value={o.openRequests} href="?tab=requests" />
        <StatCard label="Past the deadline" value={o.overdueRequests} tone={o.overdueRequests ? "danger" : undefined} />
        <StatCard label="Open breaches" value={o.openBreaches} tone={o.openBreaches ? "warning" : undefined} href="?tab=breaches" />
        <StatCard label="Active notices" value={o.notices} href="?tab=notices" />
      </div>
      <LinkTabs tabs={[{ key: "requests", label: "Requests", href: "?tab=requests" }, { key: "notices", label: "Notices & consent", href: "?tab=notices" }, { key: "breaches", label: "Breaches", href: "?tab=breaches" }, { key: "retention", label: "Retention", href: "?tab=retention" }]} active={tab} />
      {tab === "requests" && <Requests now={now} />}
      {tab === "notices" && <Notices />}
      {tab === "breaches" && <Breaches now={now} hours={cfg.breachNotifyHours} />}
      {tab === "retention" && <Retention />}
    </div>
  );
}

async function Requests({ now }: { now: Date }) {
  const rows = await db.dataRequest.findMany({ orderBy: [{ status: "asc" }, { dueAt: "asc" }], take: 200, include: { user: { select: { name: true, userType: true } } } });
  return (
    <Section title="Data-principal requests" bodyClassName="p-0">
      <DataTable head={[{ label: "Request" }, { label: "From" }, { label: "Due" }, { label: "Status" }]} empty="No requests.">
        {rows.map((r) => {
          const late = ["OPEN", "IN_PROGRESS"].includes(r.status) && r.dueAt < now;
          return (
            <tr key={r.id}>
              <Td><Link className="font-medium hover:text-primary" href={`/privacy/requests/${r.id}`}>{DATA_REQUEST_TYPE[r.type]}</Link><div className="font-mono text-[11px] text-muted-foreground">{r.number}</div></Td>
              <Td className="text-xs">{r.user.name} · {r.user.userType.toLowerCase()}</Td>
              <Td className={cn("text-xs", late && "font-medium text-tone-danger")}>{fmtDate(r.dueAt)}{late ? " · overdue" : ""}</Td>
              <Td><StatusBadge meta={DATA_REQUEST_STATUS[r.status]} /></Td>
            </tr>
          );
        })}
      </DataTable>
    </Section>
  );
}

async function Notices() {
  const notices = await db.consentNotice.findMany({ orderBy: [{ key: "asc" }, { version: "desc" }], include: { _count: { select: { records: true } } } });
  const grants = await db.consentRecord.groupBy({ by: ["noticeId", "decision"], _count: { _all: true } });
  const count = (id: string, d: "GRANTED" | "WITHDRAWN") => grants.find((g) => g.noticeId === id && g.decision === d)?._count._all ?? 0;
  return (
    <Section title="Privacy notices" description="Publishing with an existing key creates a new version; people are asked again." actions={<FormDialog title="Notice" fields={NOTICE_FIELDS} action={publishNoticeAction} submitLabel="Publish" columns={2} initial={{ audience: "ALL", required: false }} trigger={<Button size="sm"><Plus /> Publish notice</Button>} />} bodyClassName="p-0">
      <DataTable head={[{ label: "Notice" }, { label: "Audience" }, { label: "Kind" }, { label: "Decisions" }, { label: "" }]} empty="No notices yet.">
        {notices.map((n) => (
          <tr key={n.id} className={n.active ? undefined : "opacity-60"}>
            <Td><div className="font-medium">{n.title} <span className="font-mono text-xs text-muted-foreground">{n.key} v{n.version}</span></div><div className="text-xs text-muted-foreground">{n.purpose}</div></Td>
            <Td className="text-xs">{n.audience.toLowerCase()}</Td>
            <Td className="text-xs">{n.required ? "Required" : "Optional"}{n.active ? "" : " · retired"}</Td>
            <Td className="text-xs">{count(n.id, "GRANTED")} granted · {count(n.id, "WITHDRAWN")} refused / withdrawn</Td>
            <Td className="text-right">{n.active && <ActionButton size="xs" variant="ghost" label="Retire" confirmText={`Retire ${n.key} v${n.version}?`} run={retireNoticeAction.bind(null, n.id)} />}</Td>
          </tr>
        ))}
      </DataTable>
    </Section>
  );
}

async function Breaches({ now, hours }: { now: Date; hours: number }) {
  const rows = await db.breachIncident.findMany({ orderBy: { detectedAt: "desc" }, take: 100 });
  return (
    <Section
      title="Personal-data breach register"
      actions={<FormDialog title="Breach" action={reportBreachAction} submitLabel="Record breach" columns={2} initial={{ severity: "MEDIUM", affectedCount: 0 }} trigger={<Button size="sm" variant="outline"><Plus /> Record breach</Button>}
        fields={[
          { name: "title", label: "Title", type: "text", wide: true },
          { name: "detectedAt", label: "Detected at", type: "datetime-local" },
          { name: "severity", label: "Severity", type: "select", options: ["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() })) },
          { name: "dataCategories", label: "Personal data involved", type: "text", wide: true, placeholder: "Names, phone numbers, marks" },
          { name: "affectedCount", label: "People affected (estimate)", type: "number", min: 0 },
          { name: "description", label: "What happened", type: "textarea" },
        ]} />}
      bodyClassName="p-0"
    >
      <DataTable head={[{ label: "Breach" }, { label: "Detected" }, { label: "Board deadline" }, { label: "Status" }, { label: "Next step" }]} empty="No breaches recorded.">
        {rows.map((b) => {
          const deadline = addHours(b.detectedAt, hours);
          const late = !b.boardNotifiedAt && deadline < now;
          return (
            <tr key={b.id} className="align-top">
              <Td><div className="font-medium">{b.title}</div><div className="text-xs text-muted-foreground">{b.number} · {b.severity.toLowerCase()} · {b.affectedCount} affected · {b.dataCategories}</div></Td>
              <Td className="text-xs">{fmtDateTime(b.detectedAt)}</Td>
              <Td className={cn("text-xs", late && "font-medium text-tone-danger")}>{b.boardNotifiedAt ? `Informed ${fmtDateTime(b.boardNotifiedAt)}` : `${fmtDateTime(deadline)}${late ? " · overdue" : ""}`}</Td>
              <Td><StatusBadge meta={BREACH_STATUS[b.status]} /></Td>
              <Td><BreachControls id={b.id} status={b.status} /></Td>
            </tr>
          );
        })}
      </DataTable>
    </Section>
  );
}

async function Retention() {
  const rules = await db.retentionRule.findMany();
  return (
    <Section title="Retention" description="Operational data is purged daily by the retention job. Results, fees, credentials and the audit trail are statutory records and are never purged here." bodyClassName="p-0">
      <DataTable head={[{ label: "Data" }, { label: "Kept for" }, { label: "Last run" }, { label: "" }]}>
        {Object.entries(RETENTION_DATASETS).map(([key, ds]) => {
          const r = rules.find((x) => x.dataset === key);
          return (
            <tr key={key}>
              <Td className="font-medium">{ds.label}</Td>
              <Td>{r ? `${r.retainDays} days${r.active ? "" : " (paused)"}` : <span className="text-muted-foreground">kept indefinitely</span>}</Td>
              <Td className="text-xs">{r?.lastRunAt ? `${fmtDateTime(r.lastRunAt)} · ${r.lastAffected ?? 0} removed` : "—"}</Td>
              <Td className="text-right">
                <FormDialog title="Retention rule" id={r?.id ?? key} action={saveRetentionRuleAction} initial={{ dataset: key, retainDays: r?.retainDays ?? 365, active: r?.active ?? true }}
                  fields={[{ name: "dataset", label: "Dataset", type: "select", options: [{ value: key, label: ds.label }] }, { name: "retainDays", label: "Keep for (days)", type: "number", min: 1 }, { name: "active", label: "Active", type: "checkbox" }]} />
              </Td>
            </tr>
          );
        })}
      </DataTable>
    </Section>
  );
}
