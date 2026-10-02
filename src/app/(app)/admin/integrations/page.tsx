import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { Section, StatCard } from "@/components/app/page";
import { ActionButton } from "@/features/academic-ops/controls";
import { deleteEndpointAction, pingEndpointAction, redeliverAction, revokeTokenAction } from "@/features/integrations/actions";
import { ProviderForm, RotateSecretButton, WebhookForm } from "@/features/integrations/controls";
import { WEBHOOK_EVENTS } from "@/lib/domain/integrations";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { env } from "@/server/env";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  await requirePageAuth("integration.manage");
  const now = new Date();
  const [providers, endpoints, deliveries, tokens, identities] = await Promise.all([
    db.ssoProvider.findMany(),
    db.webhookEndpoint.findMany({ orderBy: { createdAt: "asc" } }),
    db.webhookDelivery.findMany({ include: { endpoint: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 40 }),
    db.apiToken.findMany({ where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, include: { user: { select: { name: true, email: true } } }, orderBy: { lastUsedAt: { sort: "desc", nulls: "last" } }, take: 200 }),
    db.userIdentity.groupBy({ by: ["provider"], _count: true }),
  ]);
  const events = Object.entries(WEBHOOK_EVENTS).map(([key, label]) => ({ key, label }));
  const prov = (kind: "GOOGLE" | "MICROSOFT") => {
    const p = providers.find((x) => x.kind === kind);
    return { enabled: p?.enabled ?? false, clientId: p?.clientId ?? "", tenant: p?.tenant ?? "", allowedDomains: p?.allowedDomains.join(", ") ?? "", configured: !!p };
  };
  return (
    <div className="space-y-6">
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
        <StatCard label="Single sign-on" value={providers.filter((p) => p.enabled).map((p) => (p.kind === "GOOGLE" ? "Google" : "Microsoft")).join(" + ") || "Off"} hint={`${identities.reduce((a, i) => a + i._count, 0)} linked accounts`} />
        <StatCard label="Webhooks" value={endpoints.filter((e) => e.active).length} hint={endpoints.some((e) => e.failingSince) ? "Some are failing" : "All healthy"} tone={endpoints.some((e) => e.failingSince) ? "warning" : undefined} />
        <StatCard label="Active API tokens" value={tokens.length} />
      </div>

      <Section title="Sign in with Google" description="For institutions using Google Workspace for Education.">
        <ProviderForm kind="GOOGLE" redirectUri={`${env.APP_URL}/api/auth/sso/google/callback`} initial={prov("GOOGLE")} />
      </Section>
      <Section title="Sign in with Microsoft" description="For institutions using Microsoft 365 (Entra ID).">
        <ProviderForm kind="MICROSOFT" redirectUri={`${env.APP_URL}/api/auth/sso/microsoft/callback`} initial={prov("MICROSOFT")} />
      </Section>

      <Section title="Webhooks" description="Tell other systems (accounting, the library system, a data warehouse) when things happen here. Each notification is a signed JSON POST; confidential areas such as examination papers, marks before publication, counselling, grievances and health are never sent.">
        <div className="space-y-6">
          {endpoints.map((e) => (
            <div key={e.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{e.name}</span>
                <span className={cn("text-xs", e.failingSince ? "text-tone-danger" : "text-muted-foreground")}>{!e.active ? "paused" : e.failingSince ? `failing since ${fmtDateTime(e.failingSince)}` : "active"}</span>
                <span className="ml-auto flex gap-2">
                  <ActionButton label="Send test" size="xs" run={pingEndpointAction.bind(null, e.id)} />
                  <ActionButton label="Delete" size="xs" variant="ghost" run={deleteEndpointAction.bind(null, e.id)} confirmText={`Delete the webhook "${e.name}" and its delivery history?`} />
                </span>
              </div>
              <WebhookForm events={events} initial={{ id: e.id, name: e.name, url: e.url, events: e.events, active: e.active }} />
              <RotateSecretButton id={e.id} />
            </div>
          ))}
          <div className="rounded-lg border border-dashed p-4"><div className="mb-3 font-medium">New webhook</div><WebhookForm events={events} /></div>
        </div>
      </Section>

      <Section title="Recent deliveries" bodyClassName="p-0">
        <DataTable head={[{ label: "When" }, { label: "Webhook" }, { label: "Event" }, { label: "Result" }, { label: "" }]} empty="Nothing sent yet.">
          {deliveries.map((d) => (
            <tr key={d.id}>
              <Td className="text-xs">{fmtDateTime(d.createdAt)}</Td>
              <Td className="text-xs">{d.endpoint.name}</Td>
              <Td className="font-mono text-xs">{d.event}</Td>
              <Td className={cn("text-xs", d.status === "DELIVERED" ? "text-tone-success" : d.status === "PENDING" ? "text-muted-foreground" : "text-tone-danger")}>{d.status.toLowerCase().replace("_", " ")}{d.responseStatus ? ` · HTTP ${d.responseStatus}` : ""}{d.error && d.status !== "DELIVERED" ? ` · ${d.error}` : ""}{d.attempts > 1 ? ` · ${d.attempts} tries` : ""}</Td>
              <Td className="text-right">{["FAILED", "GAVE_UP"].includes(d.status) && <ActionButton label="Retry" size="xs" variant="ghost" run={redeliverAction.bind(null, d.id)} />}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>

      <Section title="API tokens in use" description="Personal tokens act as their owner with the scopes chosen. Revoke any that look wrong." bodyClassName="p-0">
        <DataTable head={[{ label: "Owner" }, { label: "Token" }, { label: "Scopes" }, { label: "Last used" }, { label: "" }]} empty="No active tokens.">
          {tokens.map((k) => (
            <tr key={k.id}>
              <Td>{k.user.name}<div className="text-[11px] text-muted-foreground">{k.user.email}</div></Td>
              <Td>{k.name}<div className="font-mono text-[11px] text-muted-foreground">{k.prefix}…</div></Td>
              <Td className="text-xs">{k.scopes.join(", ")}</Td>
              <Td className="text-xs">{k.lastUsedAt ? `${fmtDateTime(k.lastUsedAt)}${k.lastUsedIp ? ` · ${k.lastUsedIp}` : ""}` : "Never"}</Td>
              <Td className="text-right"><ActionButton label="Revoke" size="xs" variant="ghost" run={revokeTokenAction.bind(null, k.id)} confirmText={`Revoke ${k.user.name}'s token "${k.name}"?`} /></Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
