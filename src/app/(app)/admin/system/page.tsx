import { CheckCircle2, XCircle } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { KeyValue, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { JOB_STATUS } from "@/lib/domain/labels";
import { fmtDateTime } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { systemHealth } from "@/server/services/system";

export const metadata: Metadata = { title: "System health" };
export const dynamic = "force-dynamic";

export default async function SystemHealthPage() {
  await requirePageAuth("system.health");
  const [health, jobs, failedEvents] = await Promise.all([
    systemHealth(),
    db.job.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { createdBy: { select: { name: true } } } }),
    db.domainEvent.findMany({ where: { processedAt: null, attempts: { gte: 5 } }, orderBy: { id: "desc" }, take: 10 }),
  ]);
  const up = health.runtime.uptimeSeconds;
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Section title="Checks" description="Recomputed on every visit." bodyClassName="p-0">
          <ul className="divide-y">
            {health.checks.map((c) => (
              <li key={c.name} className="flex items-start gap-3 px-5 py-3">
                {c.ok ? <CheckCircle2 aria-hidden className="mt-0.5 size-4.5 text-tone-success" /> : <XCircle aria-hidden className="mt-0.5 size-4.5 text-tone-danger" />}
                <div className="min-w-0">
                  <div className="text-sm font-medium">{c.name} <span className="sr-only">{c.ok ? "healthy" : "needs attention"}</span></div>
                  <div className="text-xs text-muted-foreground">{c.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Runtime">
          <KeyValue
            items={[
              ["Node.js", health.runtime.node],
              ["Environment", health.runtime.env],
              ["Uptime", `${Math.floor(up / 3600)} h ${Math.floor((up % 3600) / 60)} min`],
              ["Memory (RSS)", `${health.runtime.memoryMb} MB`],
              ["Migrations", `${health.migrations.applied} applied`],
            ]}
          />
        </Section>
      </div>
      <Section title="Recent background jobs" bodyClassName="p-0">
        {jobs.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">No jobs have run yet. Start the worker with <code>npm run worker</code>.</p>
        ) : (
          <DataTable head={[{ label: "Job" }, { label: "Status" }, { label: "Attempts", className: "text-right" }, { label: "Queued" }, { label: "Finished" }, { label: "Result / error" }]}>
            {jobs.map((j) => (
              <tr key={j.id}>
                <Td className="font-mono text-xs">{j.type}{j.createdBy && <div className="font-sans text-[11px] text-muted-foreground">by {j.createdBy.name}</div>}</Td>
                <Td><StatusBadge meta={JOB_STATUS[j.status]} /></Td>
                <Td className="text-right tabular">{j.attempts}/{j.maxAttempts}</Td>
                <Td className="text-xs whitespace-nowrap">{fmtDateTime(j.createdAt)}</Td>
                <Td className="text-xs whitespace-nowrap">{fmtDateTime(j.finishedAt)}</Td>
                <Td className="max-w-md truncate text-xs text-muted-foreground">{j.error ?? (j.result ? JSON.stringify(j.result) : "")}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
      {failedEvents.length > 0 && (
        <Section title="Events that failed after retries" bodyClassName="p-0">
          <DataTable head={[{ label: "Event" }, { label: "Record" }, { label: "Occurred" }, { label: "Error" }]}>
            {failedEvents.map((e) => (
              <tr key={e.id.toString()}>
                <Td className="font-mono text-xs">{e.type}</Td>
                <Td className="font-mono text-xs">{e.aggregateType}/{e.aggregateId}</Td>
                <Td className="text-xs">{fmtDateTime(e.occurredAt)}</Td>
                <Td className="max-w-md truncate text-xs text-destructive">{e.lastError}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
    </div>
  );
}
