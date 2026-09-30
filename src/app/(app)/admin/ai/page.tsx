import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { KeyValue, PageHeader, Section, StatCard } from "@/components/app/page";
import { AiSettingsForm } from "@/features/insight/ai-controls";
import { fmtDateTime } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { aiStatus } from "@/server/ai/gateway";

export const metadata: Metadata = { title: "AI assistance" };

export default async function AiAdminPage() {
  await requirePageAuth(["admin.settings.manage", "system.health"]);
  const since = new Date(new Date().getTime() - 30 * 86_400_000);
  const [status, byFeature, recent] = await Promise.all([
    aiStatus(),
    db.aiRequest.groupBy({ by: ["feature", "status"], where: { createdAt: { gte: since } }, _count: true, _sum: { inputTokens: true, outputTokens: true } }),
    db.aiRequest.findMany({ orderBy: { createdAt: "desc" }, take: 25, include: { user: { select: { name: true } } } }),
  ]);
  const total = byFeature.reduce((a, r) => a + r._count, 0);
  const tokens = byFeature.reduce((a, r) => a + (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0), 0);
  const errors = byFeature.filter((r) => r.status !== "OK").reduce((a, r) => a + r._count, 0);
  return (
    <div className="space-y-6">
      <PageHeader title="AI assistance" breadcrumbs={[{ label: "Configuration centre", href: "/admin" }, { label: "AI" }]} description="Optional drafting help (report definitions, feedback, announcements). Outputs are always reviewed by a person; the AI never receives database records, and prompts are redacted of common identifiers. Only usage metadata is logged." />
      <Section title="Provider">
        <KeyValue items={[["Status", status.configured ? "Configured" : "Not configured — set AI_PROVIDER=anthropic and ANTHROPIC_API_KEY in the server environment"], ["Provider", status.provider ?? "—"], ["Model", status.model ?? "—"]]} />
      </Section>
      <Section title="Institution settings"><AiSettingsForm initial={{ enabled: status.enabled, ...status.features, dailyRequestsPerUser: status.dailyRequestsPerUser }} /></Section>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
        <StatCard label="Requests (30 days)" value={total} />
        <StatCard label="Tokens (30 days)" value={tokens.toLocaleString()} />
        <StatCard label="Errors" value={errors} tone={errors ? "warning" : undefined} />
      </div>
      <Section title="Recent requests" description="Metadata only." bodyClassName="p-0">
        <DataTable head={[{ label: "When" }, { label: "User" }, { label: "Feature" }, { label: "Model" }, { label: "Tokens in/out", className: "text-right" }, { label: "Latency", className: "text-right" }, { label: "Result" }]} empty="No AI requests yet.">
          {recent.map((r) => (
            <tr key={r.id}>
              <Td className="text-xs">{fmtDateTime(r.createdAt)}</Td>
              <Td className="text-xs">{r.user.name}</Td>
              <Td className="text-xs">{r.feature}</Td>
              <Td className="text-xs">{r.model}</Td>
              <Td className="text-right text-xs tabular">{r.inputTokens}/{r.outputTokens}</Td>
              <Td className="text-right text-xs tabular">{r.latencyMs} ms</Td>
              <Td className="text-xs">{r.status.toLowerCase()}{r.error ? ` — ${r.error}` : ""}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
