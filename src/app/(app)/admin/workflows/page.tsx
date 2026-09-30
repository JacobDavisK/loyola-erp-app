import Link from "next/link";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { Section } from "@/components/app/page";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { ensureDefaultDefinitions } from "@/server/services/workflow";
import { registeredWorkflows } from "@/server/workflow/registry";

export const metadata: Metadata = { title: "Workflows" };

export default async function WorkflowsPage() {
  await requirePageAuth("workflow.manage");
  await ensureDefaultDefinitions();
  const modules = registeredWorkflows();
  const [defs, open, overdue] = await Promise.all([
    db.workflowDefinition.findMany({ orderBy: { version: "desc" } }),
    db.workflowInstance.groupBy({ by: ["key"], where: { status: { in: ["IN_PROGRESS", "RETURNED"] } }, _count: { _all: true } }),
    db.workflowTask.findMany({ where: { status: "PENDING", dueAt: { lt: new Date() }, instance: { status: "IN_PROGRESS" } }, select: { instance: { select: { key: true } } } }),
  ]);
  const overdueBy = overdue.reduce<Record<string, number>>((a, t) => ((a[t.instance.key] = (a[t.instance.key] ?? 0) + 1), a), {});
  return (
    <Section title="Approval workflows" description="Each workflow is a versioned list of approval steps. Publishing a change creates a new version; requests already in progress finish on the version they started with." bodyClassName="p-0">
      <DataTable head={[{ label: "Workflow" }, { label: "Module" }, { label: "Version" }, { label: "Steps", className: "text-right" }, { label: "Open", className: "text-right" }, { label: "Overdue tasks", className: "text-right" }, { label: "Status" }]}>
        {modules.map((m) => {
          const latest = defs.find((d) => d.key === m.key);
          const steps = Array.isArray(latest?.steps) ? (latest!.steps as unknown[]).length : m.defaultSteps.length;
          return (
            <tr key={m.key} className="hover:bg-muted/40">
              <Td>
                <Link href={`/admin/workflows/${encodeURIComponent(m.key)}`} className="font-medium hover:text-primary">{latest?.name ?? m.name}</Link>
                <div className="text-[11px] text-muted-foreground">{m.description}</div>
              </Td>
              <Td className="text-xs">{m.module}</Td>
              <Td className="text-xs tabular">v{latest?.version ?? 1}</Td>
              <Td className="text-right tabular">{steps}</Td>
              <Td className="text-right tabular">{open.find((o) => o.key === m.key)?._count._all ?? 0}</Td>
              <Td className="text-right tabular">{overdueBy[m.key] ?? 0}</Td>
              <Td className="text-xs">{latest?.isActive === false ? "Switched off" : "Active"}</Td>
            </tr>
          );
        })}
      </DataTable>
    </Section>
  );
}
