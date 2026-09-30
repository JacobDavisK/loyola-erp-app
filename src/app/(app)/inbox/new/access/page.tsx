import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader, Section } from "@/components/app/page";
import { AccessRequestForm } from "@/features/workflow/forms";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { requestableRoles } from "@/server/services/access-requests";

export const metadata: Metadata = { title: "Request access" };

export default async function RequestAccessPage() {
  const ctx = await requirePageAuth();
  if (ctx.user.userType !== "STAFF") redirect("/forbidden");
  const [roles, departments, units, campuses] = await Promise.all([
    requestableRoles(),
    db.department.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    db.academicUnit.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    db.campus.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);
  const held = new Set(ctx.roles.map((r) => r.key));
  const opt = (x: { id: string; code: string; name: string }) => ({ id: x.id, label: `${x.code} — ${x.name}` });
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Request access"
        description="Ask for an additional role. Departmental roles go to the Head of Department first, then to security approval. The role is granted automatically when approved."
        breadcrumbs={[{ label: "Approval centre", href: "/inbox" }, { label: "Request access" }]}
      />
      <Section>
        <AccessRequestForm
          roles={roles.map((r) => ({ id: r.id, label: `${r.name}${held.has(r.key) ? " — you already hold this role" : ""}`, isGlobal: r.isGlobal, description: r.description }))}
          departments={departments.map(opt)}
          units={units.map(opt)}
          campuses={campuses.map(opt)}
          ownDepartmentId={ctx.user.departmentId}
        />
      </Section>
    </div>
  );
}
