import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { StepsEditor } from "@/features/workflow/steps-editor";
import { WORKFLOW_STATUS } from "@/lib/domain/labels";
import { parseSteps } from "@/lib/domain/workflow-engine";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { activeDefinition } from "@/server/services/workflow";
import { workflowModule } from "@/server/workflow/registry";

export const metadata: Metadata = { title: "Workflow" };

export default async function WorkflowDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key: rawKey } = await params;
  const key = decodeURIComponent(rawKey);
  await requirePageAuth("workflow.manage");
  const m = workflowModule(key);
  if (!m) notFound();
  await db.$transaction((tx) => activeDefinition(tx, key)).catch(() => null);
  const [versions, instances, roles] = await Promise.all([
    db.workflowDefinition.findMany({ where: { key }, orderBy: { version: "desc" }, include: { _count: { select: { instances: true } } } }),
    db.workflowInstance.findMany({ where: { key }, orderBy: { createdAt: "desc" }, take: 15, include: { initiator: { select: { name: true } }, tasks: { where: { status: "PENDING" }, select: { assignee: { select: { name: true } }, dueAt: true } } } }),
    db.role.findMany({ orderBy: { rank: "asc" }, select: { key: true, name: true } }),
  ]);
  const latest = versions[0];
  if (!latest) notFound();
  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground"><Link href="/admin/workflows" className="hover:text-foreground">Workflows</Link> / {latest.name}</nav>
      <StepsEditor
        workflowKey={key}
        name={latest.name}
        description={latest.description ?? m.description}
        steps={parseSteps(latest.steps)}
        version={latest.version}
        active={latest.isActive}
        roles={roles.map((r) => ({ value: r.key, label: r.name }))}
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Recent requests" bodyClassName="p-0">
          {instances.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">No requests yet.</p>
          ) : (
            <DataTable head={[{ label: "Request" }, { label: "Status" }, { label: "Waiting on" }]}>
              {instances.map((i) => (
                <tr key={i.id}>
                  <Td><Link href={`/inbox/requests/${i.id}`} className="font-medium hover:text-primary">{i.title}</Link><div className="text-[11px] text-muted-foreground">{i.initiator.name} · {fmtDateTime(i.createdAt)}</div></Td>
                  <Td><StatusBadge meta={WORKFLOW_STATUS[i.status]} /></Td>
                  <Td className="text-xs">{i.tasks.map((t) => `${t.assignee.name}${t.dueAt ? ` (due ${fmtRelative(t.dueAt)})` : ""}`).join(", ") || "—"}</Td>
                </tr>
              ))}
            </DataTable>
          )}
        </Section>
        <Section title="Version history" bodyClassName="p-0">
          <DataTable head={[{ label: "Version" }, { label: "Published" }, { label: "Requests", className: "text-right" }, { label: "" }]}>
            {versions.map((v) => (
              <tr key={v.id}>
                <Td className="tabular">v{v.version}</Td>
                <Td className="text-xs">{fmtDateTime(v.createdAt)}</Td>
                <Td className="text-right tabular">{v._count.instances}</Td>
                <Td className="text-xs">{v.id === latest.id ? (v.isActive ? "Current" : "Current (switched off)") : ""}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      </div>
    </div>
  );
}
