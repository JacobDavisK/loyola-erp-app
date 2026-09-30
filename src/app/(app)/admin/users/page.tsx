import Link from "next/link";
import type { Metadata } from "next";
import type { Prisma } from "@/generated/prisma/client";
import { DataTable, Pagination, qs, SearchForm, Td } from "@/components/app/list";
import { UserDialog } from "@/features/admin/user-dialog";
import { fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageAuth("admin.users.manage");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = 30;
  const f: Prisma.UserWhereInput[] = [{ deletedAt: null }];
  if (sp.q) f.push({ OR: [{ name: { contains: sp.q, mode: "insensitive" } }, { email: { contains: sp.q, mode: "insensitive" } }, { employeeId: { contains: sp.q, mode: "insensitive" } }] });
  if (sp.role) f.push({ roles: { some: { roleId: sp.role } } });
  if (sp.status) f.push({ status: sp.status as "ACTIVE" | "SUSPENDED" });
  const where = { AND: f };
  const [rows, total, roles, departments] = await Promise.all([
    db.user.findMany({ where, orderBy: { name: "asc" }, skip: (page - 1) * pageSize, take: pageSize, include: { department: { select: { code: true } }, roles: { include: { role: { select: { name: true } }, department: { select: { code: true } } } } } }),
    db.user.count({ where }),
    db.role.findMany({ orderBy: { rank: "asc" } }),
    db.department.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" } }),
  ]);
  const now = new Date();
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form className="flex flex-wrap gap-2">
          {sp.q && <input type="hidden" name="q" value={sp.q} />}
          <select name="role" defaultValue={sp.role ?? ""} aria-label="Role" className="h-8 rounded-lg border bg-card px-2 text-[13px]">
            <option value="">All roles</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="h-8 rounded-lg border bg-card px-2 text-[13px]">
            <option value="">Any status</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
          <button className="h-8 rounded-lg border px-3 text-[13px] hover:bg-muted">Apply</button>
        </form>
        <SearchForm defaultValue={sp.q} placeholder="Name, e-mail or employee ID" hidden={{ role: sp.role, status: sp.status }} />
        <div className="ml-auto">
          <UserDialog departments={departments.map((d) => ({ id: d.id, label: `${d.code} — ${d.name}` }))} roles={roles.map((r) => ({ id: r.id, label: r.name, isGlobal: r.isGlobal }))} />
        </div>
      </div>
      <div className="surface-card overflow-hidden">
        <DataTable head={[{ label: "User" }, { label: "Employee ID" }, { label: "Dept" }, { label: "Roles" }, { label: "Security" }, { label: "Last sign-in" }]}>
          {rows.map((u) => (
            <tr key={u.id} className="hover:bg-muted/40">
              <Td><Link href={`/admin/users/${u.id}`} className="font-medium hover:text-primary">{u.name}</Link><div className="text-xs text-muted-foreground">{u.email}</div></Td>
              <Td className="font-mono text-xs">{u.employeeId}</Td>
              <Td className="text-xs">{u.department?.code ?? "—"}</Td>
              <Td><div className="flex max-w-xs flex-wrap gap-1">{u.roles.map((r) => <span key={r.id} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{r.role.name}{r.department ? ` · ${r.department.code}` : ""}</span>)}</div></Td>
              <Td className="text-xs">
                <span className={cn(u.status === "SUSPENDED" && "font-semibold text-tone-danger")}>{u.status === "ACTIVE" ? "Active" : u.status === "SUSPENDED" ? "Suspended" : "Invited"}</span>
                {u.lockedUntil && u.lockedUntil > now && <span className="ml-1 font-semibold text-tone-warning">· Locked</span>}
                {u.mfaEnabled && <span className="ml-1 text-tone-success">· MFA</span>}
              </Td>
              <Td className="text-xs whitespace-nowrap text-muted-foreground">{u.lastLoginAt ? fmtRelative(u.lastLoginAt) : "Never"}</Td>
            </tr>
          ))}
        </DataTable>
        <Pagination page={page} pageSize={pageSize} total={total} hrefFor={(p) => `/admin/users${qs({ q: sp.q, role: sp.role, status: sp.status }, { page: p })}`} />
      </div>
    </div>
  );
}
