"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAuth } from "@/server/auth/current";
import { invalid } from "@/server/errors";
import {
  createUser, exportConfiguration, grantRole, restoreSettings, revokeRole, saveInstitution, saveRole, saveSetting, updateUser, uploadLogo, userSecurityAction,
} from "@/server/services/admin";
import type { SettingKey } from "@/server/services/settings";

const refresh = () => revalidatePath("/admin", "layout");

export async function createUserAction(input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("admin.users.manage");
    const u = await createUser(ctx, input);
    refresh();
    return { id: u.id };
  }, "User created — invitation e-mail queued");
}

export async function updateUserAction(id: string, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("admin.users.manage");
    await updateUser(ctx, id, input);
    refresh();
  }, "User updated");
}

export async function userSecurityActionAction(id: string, op: "suspend" | "activate" | "unlock" | "reset-mfa" | "resend-invite" | "sign-out") {
  return runAction(async () => {
    const ctx = await requireAuth("admin.users.manage");
    await userSecurityAction(ctx, id, op);
    refresh();
  }, "Done");
}

export async function grantRoleAction(userId: string, roleId: string, scope: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("admin.roles.manage");
    await grantRole(ctx, userId, roleId, scope);
    refresh();
  }, "Role granted");
}

export async function revokeRoleAction(grantId: string) {
  return runAction(async () => {
    const ctx = await requireAuth("admin.roles.manage");
    await revokeRole(ctx, grantId);
    refresh();
  }, "Role revoked");
}

export async function saveRoleAction(id: string | null, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("admin.roles.manage");
    const r = await saveRole(ctx, id, input);
    refresh();
    return { id: r.id };
  }, "Role saved");
}

export async function saveSettingAction(key: SettingKey, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("admin.settings.manage");
    await saveSetting(ctx, key, input);
    refresh();
  }, "Settings saved");
}

export async function saveInstitutionAction(input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("admin.institution.manage");
    await saveInstitution(ctx, input);
    refresh();
  }, "Institution profile saved");
}

export async function uploadLogoAction(form: FormData) {
  return runAction(async () => {
    const ctx = await requireAuth("admin.institution.manage");
    const f = form.get("file");
    if (!(f instanceof File)) throw invalid("Choose an image.");
    await uploadLogo(ctx, Buffer.from(await f.arrayBuffer()), f.name);
    refresh();
  }, "Logo updated");
}

export async function exportConfigAction() {
  return runAction(async () => {
    const ctx = await requireAuth("admin.backup");
    return JSON.stringify(await exportConfiguration(ctx), null, 2);
  });
}

export async function restoreSettingsAction(json: string) {
  return runAction(async () => {
    const ctx = await requireAuth("admin.backup");
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw invalid("The file is not valid JSON.");
    }
    const n = await restoreSettings(ctx, parsed);
    refresh();
    return n;
  });
}
