import { PageHeader } from "@/components/app/page";
import { AdminNav } from "@/features/admin/admin-nav";
import { ADMIN_TABS } from "@/features/admin/tabs";
import { can, requirePageAuth } from "@/server/auth/current";



export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageAuth(ADMIN_TABS.map((t) => t.perm));
  const tabs = ADMIN_TABS.filter((t) => can(ctx, t.perm)).map(({ key, label, href }) => ({ key, label, href }));
  return (
    <div>
      <PageHeader title="Configuration centre" description="Users and roles, institution profile, approval workflows, security policy, examination rules and system health." />
      <AdminNav tabs={tabs} />
      {children}
    </div>
  );
}
