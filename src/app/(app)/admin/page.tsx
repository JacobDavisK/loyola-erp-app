import { redirect } from "next/navigation";
import { can, requirePageAuth } from "@/server/auth/current";
import { ADMIN_TABS } from "@/features/admin/tabs";

export default async function AdminIndex() {
  const ctx = await requirePageAuth();
  const first = ADMIN_TABS.find((t) => can(ctx, t.perm));
  redirect(first?.href ?? "/forbidden");
}
