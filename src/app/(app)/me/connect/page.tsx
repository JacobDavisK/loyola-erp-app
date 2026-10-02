import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ActionButton } from "@/features/academic-ops/controls";
import { deleteFeedAction, revokeTokenAction, unlinkIdentityAction } from "@/features/integrations/actions";
import { CalendarLinkButton, TokenCreator } from "@/features/integrations/controls";
import { API_SCOPES } from "@/lib/domain/integrations";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { getT } from "@/server/i18n";

export const metadata: Metadata = { title: "API & calendar" };

export default async function ConnectPage() {
  const ctx = await requirePageAuth();
  const t = await getT();
  const [tokens, feed, identities] = await Promise.all([
    db.apiToken.findMany({ where: { userId: ctx.user.id }, orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }] }),
    db.calendarFeed.findUnique({ where: { userId: ctx.user.id } }),
    db.userIdentity.findMany({ where: { userId: ctx.user.id }, orderBy: { createdAt: "asc" } }),
  ]);
  const now = new Date();
  const scopes = Object.entries(API_SCOPES)
    .filter(([k]) => ctx.user.userType === "STAFF" || ["profile:read", "self:read", "events:read", "finance:read"].includes(k))
    .map(([key, label]) => ({ key, label }));
  return (
    <div className="space-y-6">
      <PageHeader title={t("API & calendar")} description="Language, your calendar on your phone, the accounts you sign in with, and tokens that let other apps and AI assistants read your information." />
      <Section title={t("Interface language")} description={t("Choose the language for menus and the student portal. Pages not yet translated stay in English.")}>
        <LanguageSwitcher current={ctx.user.locale} label={t("Language")} className="text-sm" />
      </Section>

      <Section title="Calendar subscription" description="Your classes, examinations, assignment deadlines, registered events and room bookings in Google Calendar, Outlook or your phone's calendar. It updates by itself every few hours.">
        {feed && <p className="mb-3 text-sm text-muted-foreground">A link was created on {fmtDate(feed.createdAt)}. For safety it is shown only once; replace it to get a new one.</p>}
        <div className="flex flex-wrap items-start gap-3">
          <CalendarLinkButton exists={!!feed} />
          {feed && <ActionButton label="Switch off" size="sm" variant="ghost" run={deleteFeedAction} confirmText="Switch off the calendar link? Subscribed calendars stop updating." />}
        </div>
      </Section>

      <Section title="Sign-in accounts" description="Google or Microsoft accounts you have used to sign in here." bodyClassName="p-0">
        <DataTable head={[{ label: "Provider" }, { label: "Account" }, { label: "Last used" }, { label: "" }]} empty="None — you sign in with your password.">
          {identities.map((i) => (
            <tr key={i.id}>
              <Td>{i.provider === "GOOGLE" ? "Google" : "Microsoft"}</Td>
              <Td className="text-xs">{i.email}</Td>
              <Td className="text-xs">{fmtDateTime(i.lastUsedAt)}</Td>
              <Td className="text-right"><ActionButton label="Unlink" size="xs" variant="ghost" run={unlinkIdentityAction.bind(null, i.id)} confirmText="Unlink this account? You can sign in with it again later if the e-mail still matches." /></Td>
            </tr>
          ))}
        </DataTable>
      </Section>

      <Section title="Personal access tokens" description={<>A token lets another program read what you can see — never more, and only the parts you tick. Use it with the REST API (<code>{env.APP_URL}/api/v1</code>, described at <a className="text-primary hover:underline" href="/api/v1/openapi.json">/api/v1/openapi.json</a>) or add the AI connector to an assistant such as Claude as a remote MCP server: <code>{env.APP_URL}/api/mcp</code> with the token as the bearer token.</>}>
        <TokenCreator scopes={scopes} />
      </Section>
      {tokens.length > 0 && (
        <Section title="Your tokens" bodyClassName="p-0">
          <DataTable head={[{ label: "Name" }, { label: "Scopes" }, { label: "Last used" }, { label: "Expires" }, { label: "" }]}>
            {tokens.map((k) => {
              const dead = !!k.revokedAt || (!!k.expiresAt && k.expiresAt < now);
              return (
                <tr key={k.id} className={dead ? "opacity-60" : undefined}>
                  <Td>{k.name}<div className="font-mono text-[11px] text-muted-foreground">{k.prefix}…</div></Td>
                  <Td className="text-xs">{k.scopes.join(", ")}</Td>
                  <Td className="text-xs">{k.lastUsedAt ? `${fmtDateTime(k.lastUsedAt)}${k.lastUsedIp ? ` from ${k.lastUsedIp}` : ""}` : "Never"}</Td>
                  <Td className="text-xs">{k.revokedAt ? `Revoked ${fmtDate(k.revokedAt)}` : k.expiresAt ? fmtDate(k.expiresAt) : "Never"}</Td>
                  <Td className="text-right">{!dead && <ActionButton label="Revoke" size="xs" variant="ghost" run={revokeTokenAction.bind(null, k.id)} confirmText={`Revoke "${k.name}"? Programs using it stop working at once.`} />}</Td>
                </tr>
              );
            })}
          </DataTable>
        </Section>
      )}
    </div>
  );
}
