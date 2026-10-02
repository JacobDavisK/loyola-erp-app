"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAuth } from "@/server/auth/current";
import { deleteDemoAccess, grantDemoAccess, resetDemoPassword, revokeDemoAccess } from "@/server/services/demo-access";

const refresh = () => revalidatePath("/admin/demo-users");

export async function grantDemoAccessAction(demoUserId: string, input: unknown) {
  return runAction(async () => { const r = await grantDemoAccess(await requireAuth("demo.manage"), demoUserId, input); refresh(); return r; }, "Access given — copy the password now");
}
export async function resetDemoPasswordAction(grantId: string) {
  return runAction(async () => { const r = await resetDemoPassword(await requireAuth("demo.manage"), grantId); refresh(); return r; }, "New password generated — copy it now");
}
export async function revokeDemoAccessAction(grantId: string) {
  return runAction(async () => { await revokeDemoAccess(await requireAuth("demo.manage"), grantId); refresh(); }, "Access revoked");
}
export async function deleteDemoAccessAction(grantId: string) {
  return runAction(async () => { await deleteDemoAccess(await requireAuth("demo.manage"), grantId); refresh(); }, "Removed");
}
