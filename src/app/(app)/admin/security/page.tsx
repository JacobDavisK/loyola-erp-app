import type { Metadata } from "next";
import { SettingsForm, type SettingField } from "@/features/admin/settings-form";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { getSetting } from "@/server/services/settings";

export const metadata: Metadata = { title: "Security settings" };

const FIELDS: SettingField[] = [
  { key: "passwordMinLength", label: "Minimum password length", type: "number", min: 8, max: 128, suffix: "characters" },
  { key: "passwordRequireUpper", label: "Require an uppercase letter", type: "boolean" },
  { key: "passwordRequireLower", label: "Require a lowercase letter", type: "boolean" },
  { key: "passwordRequireDigit", label: "Require a number", type: "boolean" },
  { key: "passwordRequireSymbol", label: "Require a symbol", type: "boolean" },
  { key: "passwordMaxAgeDays", label: "Password maximum age", hint: "0 disables forced rotation.", type: "number", min: 0, max: 730, suffix: "days" },
  { key: "maxFailedLogins", label: "Failed sign-ins before lockout", type: "number", min: 3, max: 20, suffix: "attempts" },
  { key: "lockoutMinutes", label: "Lockout duration", type: "number", min: 1, max: 1440, suffix: "minutes" },
  { key: "sessionIdleMinutes", label: "Idle session timeout", type: "number", min: 5, max: 720, suffix: "minutes" },
  { key: "sessionAbsoluteHours", label: "Maximum session length", type: "number", min: 1, max: 72, suffix: "hours" },
  { key: "rememberDeviceDays", label: "“Remember this device” duration", type: "number", min: 1, max: 90, suffix: "days" },
  { key: "requireMfaForRoles", label: "Roles that must use two-step verification", hint: "Users in these roles are asked to enrol at sign-in.", type: "roles" },
  { key: "signedUrlTtlSeconds", label: "Signed download link lifetime", type: "number", min: 30, max: 3600, suffix: "seconds" },
  { key: "maxFinalDownloadsPerUserPerDay", label: "Final-paper downloads per user per day", type: "number", min: 1, max: 500, suffix: "downloads" },
  { key: "auditRetentionYears", label: "Audit log retention", hint: "Entries are never deleted before this period ends.", type: "number", min: 1, max: 50, suffix: "years" },
];

export default async function SecuritySettingsPage() {
  await requirePageAuth("admin.settings.manage");
  const [value, roles] = await Promise.all([getSetting("security"), db.role.findMany({ orderBy: { rank: "asc" }, select: { key: true, name: true } })]);
  return (
    <SettingsForm
      settingKey="security"
      fields={FIELDS}
      initial={value}
      roleOptions={roles}
      groups={[
        { title: "Password policy", keys: ["passwordMinLength", "passwordRequireUpper", "passwordRequireLower", "passwordRequireDigit", "passwordRequireSymbol", "passwordMaxAgeDays"] },
        { title: "Sign-in protection", keys: ["maxFailedLogins", "lockoutMinutes", "requireMfaForRoles"] },
        { title: "Sessions", keys: ["sessionIdleMinutes", "sessionAbsoluteHours", "rememberDeviceDays"] },
        { title: "Downloads & retention", keys: ["signedUrlTtlSeconds", "maxFinalDownloadsPerUserPerDay", "auditRetentionYears"] },
      ]}
    />
  );
}
