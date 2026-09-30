"use server";

import { redirect } from "next/navigation";
import { getAuth, requireAuth } from "@/server/auth/current";
import { destroyCurrentSession } from "@/server/auth/session";
import { runAction } from "@/server/action";
import { db } from "@/server/db";
import { audit } from "@/server/services/audit";
import { globalSearch } from "@/server/services/search";

export async function searchEverything(q: string) {
  return runAction(async () => {
    const ctx = await requireAuth();
    return globalSearch(ctx, String(q ?? ""));
  });
}

export async function markNotificationRead(id: string) {
  return runAction(async () => {
    const ctx = await requireAuth();
    await db.notification.updateMany({ where: { id, userId: ctx.user.id, readAt: null }, data: { readAt: new Date() } });
  });
}

export async function markAllNotificationsRead() {
  return runAction(async () => {
    const ctx = await requireAuth();
    await db.notification.updateMany({ where: { userId: ctx.user.id, readAt: null }, data: { readAt: new Date() } });
  });
}

export async function logoutAction() {
  const ctx = await getAuth();
  const userId = await destroyCurrentSession();
  if (userId) await audit({ actorId: userId, actorName: ctx?.user.name, action: "auth.logout", resourceType: "user", resourceId: userId, summary: "Signed out" });
  redirect("/login?signedOut=1");
}
