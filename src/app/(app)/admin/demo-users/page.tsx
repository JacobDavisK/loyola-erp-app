import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { Section, StatCard } from "@/components/app/page";
import { ActionButton } from "@/features/academic-ops/controls";
import { deleteDemoAccessAction, revokeDemoAccessAction } from "@/features/admin/demo-actions";
import { GrantDemoAccess, ResetDemoPassword } from "@/features/admin/demo-users";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requirePageAuth } from "@/server/auth/current";
import { env } from "@/server/env";
import { demoAccounts } from "@/server/services/demo-access";

export const metadata: Metadata = { title: "Demo Users" };

export default async function DemoUsersPage() {
  await requirePageAuth("demo.manage");
  const accounts = await demoAccounts();
  const now = new Date();
  const active = (g: { revokedAt: Date | null; expiresAt: Date | null }) => !g.revokedAt && (!g.expiresAt || g.expiresAt > now);
  const grants = accounts.flatMap((a) => a.grants);
  const signInUrl = `${env.APP_URL}/login`;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
        <StatCard label="Demo accounts" value={accounts.length} />
        <StatCard label="People with access" value={grants.filter(active).length} />
        <StatCard label="Signed in this week" value={grants.filter((g) => g.lastUsedAt && now.getTime() - g.lastUsedAt.getTime() < 7 * 86_400_000).length} />
      </div>
      <Section
        title="Demo Users"
        description="The demonstration accounts, covering every role. To let someone try the system, enrol their e-mail against an account and generate a password; they sign in with their own e-mail and work as that account. Every sign-in is recorded in the audit log under their e-mail. The Super Admin account is never shared."
        bodyClassName="p-0"
      >
        <DataTable head={[{ label: "Demo account" }, { label: "Role" }, { label: "People with access" }, { label: "" }]} empty="No demo accounts.">
          {accounts.map((a) => (
            <tr key={a.id} className="align-top">
              <Td><div className="font-medium">{a.name}</div><div className="font-mono text-[11px] text-muted-foreground">{a.email}</div></Td>
              <Td className="text-xs">{a.roles.join(", ") || a.userType.toLowerCase()}</Td>
              <Td>
                {a.grants.length === 0 ? <span className="text-xs text-muted-foreground">—</span> : (
                  <ul className="space-y-2">
                    {a.grants.map((g) => {
                      const on = active(g);
                      return (
                        <li key={g.id} className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs", !on && "opacity-60")}>
                          <span className="font-medium">{g.name ? `${g.name} · ` : ""}{g.email}</span>
                          <span className="text-muted-foreground">
                            {g.revokedAt ? "revoked" : g.expiresAt && g.expiresAt <= now ? "expired" : g.expiresAt ? `until ${fmtDate(g.expiresAt)}` : "no end date"}
                            {" · "}{g.lastUsedAt ? `last signed in ${fmtDateTime(g.lastUsedAt)}` : "not used yet"}
                          </span>
                          <span className="flex gap-1">
                            <ResetDemoPassword grantId={g.id} account={a.name} signInUrl={signInUrl} />
                            {on ? <ActionButton label="Revoke" size="xs" variant="ghost" run={revokeDemoAccessAction.bind(null, g.id)} confirmText={`Revoke ${g.email}'s access? They are signed out at once.`} />
                              : <ActionButton label="Remove" size="xs" variant="ghost" run={deleteDemoAccessAction.bind(null, g.id)} confirmText={`Remove ${g.email} from the list?`} />}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Td>
              <Td className="text-right">{a.status === "ACTIVE" && <GrantDemoAccess demoUserId={a.id} account={`${a.name} (${a.roles[0] ?? a.userType.toLowerCase()})`} signInUrl={signInUrl} />}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
