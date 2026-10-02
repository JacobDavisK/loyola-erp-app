"use server";

import { revalidatePath } from "next/cache";
import type { SsoProviderKind } from "@/generated/prisma/client";
import { runAction } from "@/server/action";
import { requireAuth } from "@/server/auth/current";
import { createToken, revokeToken } from "@/server/services/api-tokens";
import { createFeed, deleteFeed } from "@/server/services/calendar";
import { saveProvider, unlinkIdentity } from "@/server/services/sso";
import { deleteEndpoint, pingEndpoint, redeliver, rotateSecret, saveEndpoint } from "@/server/services/webhooks";

const refresh = (...paths: string[]) => {
  for (const p of paths) revalidatePath(p);
};

// Personal: tokens, calendar, linked sign-ins
export async function createTokenAction(input: unknown) {
  return runAction(async () => { const r = await createToken(await requireAuth(), input); refresh("/me/connect"); return r; }, "Token created — copy it now");
}
export async function revokeTokenAction(id: string) {
  return runAction(async () => { await revokeToken(await requireAuth(), id); refresh("/me/connect", "/admin/integrations"); }, "Token revoked");
}
export async function createFeedAction() {
  return runAction(async () => { const url = await createFeed(await requireAuth()); refresh("/me/connect"); return { url }; }, "Calendar link created — copy it now");
}
export async function deleteFeedAction() {
  return runAction(async () => { await deleteFeed(await requireAuth()); refresh("/me/connect"); }, "Calendar link switched off");
}
export async function unlinkIdentityAction(id: string) {
  return runAction(async () => { await unlinkIdentity(await requireAuth(), id); refresh("/me/connect"); }, "Unlinked");
}

// Administration: single sign-on and webhooks
export async function saveProviderAction(kind: string | null, input: unknown) {
  return runAction(async () => { await saveProvider(await requireAuth("integration.manage"), kind as SsoProviderKind, input); refresh("/admin/integrations", "/login"); }, "Sign-in provider saved");
}
export async function saveEndpointAction(id: string | null, input: unknown) {
  return runAction(async () => { const r = await saveEndpoint(await requireAuth("integration.manage"), id, input); refresh("/admin/integrations"); return r; }, "Webhook saved");
}
export async function rotateSecretAction(id: string) {
  return runAction(async () => { const secret = await rotateSecret(await requireAuth("integration.manage"), id); return { secret }; }, "New signing secret — copy it now");
}
export async function deleteEndpointAction(id: string) {
  return runAction(async () => { await deleteEndpoint(await requireAuth("integration.manage"), id); refresh("/admin/integrations"); }, "Webhook deleted");
}
export async function pingEndpointAction(id: string) {
  return runAction(async () => { const r = await pingEndpoint(await requireAuth("integration.manage"), id); refresh("/admin/integrations"); return r; }, "Test sent");
}
export async function redeliverAction(id: string) {
  return runAction(async () => { await redeliver(await requireAuth("integration.manage"), id); refresh("/admin/integrations"); }, "Delivery retried");
}
