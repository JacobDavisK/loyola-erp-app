import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { KeyValue, Section } from "@/components/app/page";
import { RoleGrants, SecurityButtons } from "@/features/admin/user-controls";
import { UserDialog } from "@/features/admin/user-dialog";
import { fmtDateTime } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "User" };

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth("admin.users.manage");
  const u = await db.user.findFirst({ where: { id, deletedAt: null }, include: { department: true, roles: { include: { role: true, department: true, academicUnit: true, campus: true } } } });
  if (!u) notFound();
  const [roles, departments, units, campuses, events, sessions] = await Promise.all([
    db.role.findMany({ orderBy: { rank: "asc" } }),
    db.department.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" } }),
    db.academicUnit.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" } }),
    db.campus.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" } }),
    db.auditLog.findMany({ where: { OR: [{ actorId: id }, { resourceId: id }] }, orderBy: { id: "desc" }, take: 12 }),
    db.session.count({ where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  const locked = !!u.lockedUntil && u.lockedUntil > new Date();
  const ops = [
    u.status === "ACTIVE" ? ("suspend" as const) : ("activate" as const),
    ...(locked ? (["unlock"] as const) : []),
    ...(u.mfaEnabled ? (["reset-mfa"] as const) : []),
    "resend-invite" as const,
    ...(sessions ? (["sign-out"] as const) : []),
  ].filter((op) => !(op === "suspend" && id === ctx.user.id));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{u.name}</h2>
          <p className="text-sm text-muted-foreground">{u.designation}{u.department ? ` · ${u.department.name}` : ""}</p>
        </div>
        <UserDialog
          userId={u.id}
          departments={departments.map((d) => ({ id: d.id, label: `${d.code} — ${d.name}` }))}
          roles={[]}
          initial={{ name: u.name, email: u.email, employeeId: u.employeeId, designation: u.designation ?? "", phone: u.phone ?? "", departmentId: u.departmentId ?? "" }}
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Account">
          <KeyValue
            items={[
              ["E-mail", u.email],
              ["Employee ID", <span key="e" className="font-mono">{u.employeeId}</span>],
              ["Status", u.status === "ACTIVE" ? "Active" : u.status === "SUSPENDED" ? "Suspended" : "Invited"],
              ["Locked", locked ? `Until ${fmtDateTime(u.lockedUntil)}` : "No"],
              ["Two-step verification", u.mfaEnabled ? "Enabled" : "Not enabled"],
              ["Active sessions", sessions],
              ["Last sign-in", fmtDateTime(u.lastLoginAt)],
              ["Password changed", fmtDateTime(u.passwordChangedAt)],
            ]}
          />
          <div className="mt-5"><SecurityButtons userId={u.id} ops={ops} /></div>
        </Section>
        <Section title="Roles" description={can(ctx, "admin.roles.manage") ? "Institution-wide roles see every department; others are limited to their department." : "Role changes require role-management permission."}>
          {can(ctx, "admin.roles.manage") ? (
            <RoleGrants
              userId={u.id}
              grants={u.roles.map((r) => ({
                id: r.id,
                role: r.role.name,
                scope: r.role.isGlobal ? null : (r.department?.code ?? r.academicUnit?.code ?? r.campus?.code ?? u.department?.code ?? null),
                validUntil: r.validUntil ? r.validUntil.toISOString().slice(0, 10) : null,
              }))}
              roles={roles.map((r) => ({ id: r.id, name: r.name, isGlobal: r.isGlobal }))}
              departments={departments.map((d) => ({ id: d.id, label: `${d.code} — ${d.name}` }))}
              units={units.map((d) => ({ id: d.id, label: `${d.code} — ${d.name}` }))}
              campuses={campuses.map((d) => ({ id: d.id, label: `${d.code} — ${d.name}` }))}
            />
          ) : (
            <ul className="flex flex-wrap gap-2">{u.roles.map((r) => <li key={r.id} className="rounded-full border px-3 py-1 text-sm">{r.role.name}</li>)}</ul>
          )}
        </Section>
      </div>
      <Section title="Recent activity" bodyClassName="p-0">
        <ul className="divide-y text-sm">
          {events.map((e) => (
            <li key={e.id.toString()} className="flex gap-3 px-5 py-2.5">
              <code className="rounded bg-muted px-1.5 text-[11px]">{e.action}</code>
              <span className="min-w-0 flex-1 truncate">{e.summary}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{fmtDateTime(e.createdAt)}</span>
            </li>
          ))}
          {events.length === 0 && <li className="px-5 py-4 text-muted-foreground">No activity recorded.</li>}
        </ul>
      </Section>
    </div>
  );
}
