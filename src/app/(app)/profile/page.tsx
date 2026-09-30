import type { Metadata } from "next";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { MfaPanel, PasswordForm, SessionsList } from "@/features/profile/security-panel";
import { fmtDateTime } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Profile & security" };

export default async function ProfilePage() {
  const ctx = await requirePageAuth();
  const [user, sessions, logins] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: ctx.user.id }, include: { department: true } }),
    db.session.findMany({ where: { userId: ctx.user.id, revokedAt: null, mfaPending: false, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } }),
    db.loginAttempt.findMany({ where: { identifier: { in: [ctx.user.email.toLowerCase(), ctx.user.employeeId.toLowerCase()] } }, orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  const initials = user.name.replace(/^(Dr\.|Prof\.)\s*/, "").split(" ").slice(0, 2).map((p) => p[0]).join("");
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Profile & security" />
      <section className="surface-card flex flex-wrap items-center gap-5 p-6">
        <div className="grid size-16 place-items-center rounded-2xl bg-primary/10 text-xl font-semibold text-primary">{initials}</div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{user.name}</h2>
          <p className="text-sm text-muted-foreground">{user.designation}{user.department ? ` · ${user.department.name}` : ""}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ctx.roles.map((r) => <span key={`${r.key}-${r.departmentId}`} className="rounded-full bg-muted px-2.5 py-0.5 text-xs">{r.name}{r.departmentName ? ` · ${r.departmentName}` : ""}</span>)}
          </div>
        </div>
      </section>
      <Section title="Account">
        <KeyValue
          items={[
            ["Employee ID", <span key="e" className="font-mono">{user.employeeId}</span>],
            ["E-mail", user.email],
            ["Phone", user.phone ?? "—"],
            ["Department", user.department?.name ?? "—"],
            ["Last sign-in", fmtDateTime(user.lastLoginAt)],
            ["Password changed", fmtDateTime(user.passwordChangedAt)],
          ]}
        />
        <p className="mt-4 text-xs text-muted-foreground">Contact your administrator to change your name or e-mail. Additional roles can be requested from the Approval centre.</p>
      </Section>
      <div id="security" className="scroll-mt-20" />
      <Section title="Two-step verification"><MfaPanel enabled={user.mfaEnabled} /></Section>
      <Section title="Password"><PasswordForm /></Section>
      <Section title="Active sessions" description="Devices currently signed in to your account" bodyClassName="px-5 py-1">
        <SessionsList sessions={sessions.map((s) => ({ id: s.id, device: s.deviceLabel ?? "Unknown device", ip: s.ip, lastSeen: s.lastSeenAt.toISOString(), created: s.createdAt.toISOString(), current: s.id === ctx.sessionId, remember: s.remember }))} />
      </Section>
      <Section title="Recent sign-in activity" bodyClassName="p-0">
        <ul className="divide-y text-sm">
          {logins.map((l) => (
            <li key={l.id} className="flex items-center justify-between px-5 py-2.5">
              <span className={l.success ? "" : "font-medium text-tone-danger"}>{l.success ? "Successful sign-in" : `Failed sign-in (${(l.reason ?? "").replace("_", " ")})`}</span>
              <span className="text-xs text-muted-foreground">{l.ip ?? "—"} · {fmtDateTime(l.createdAt)}</span>
            </li>
          ))}
          {logins.length === 0 && <li className="px-5 py-4 text-muted-foreground">No sign-in activity recorded.</li>}
        </ul>
      </Section>
    </div>
  );
}
