import type { Metadata } from "next";
import { SettingsForm, type SettingField } from "@/features/admin/settings-form";
import { requirePageAuth } from "@/server/auth/current";
import { getSetting } from "@/server/services/settings";

export const metadata: Metadata = { title: "Examination rules" };

const FIELDS: SettingField[] = [
  { key: "allowSelfApproval", label: "Allow setters to approve their own papers", hint: "Off by default. When on, a person who set a paper may also give final approval.", type: "boolean" },
  { key: "requireMfaForApproval", label: "Require two-step verification to approve papers", type: "boolean" },
  { key: "moderatorsCanEditMetadata", label: "Moderators may change examination metadata", type: "boolean" },
  { key: "reuseCoolOffSessions", label: "Question reuse cool-off", hint: "Questions used in this many previous sessions are excluded from automatic generation.", type: "number", min: 0, max: 20, suffix: "sessions" },
  { key: "duplicateThreshold", label: "Duplicate similarity threshold", hint: "0.30–1.00. Lower values flag more pairs as potential duplicates.", type: "number", min: 0.3, max: 1, step: 0.05, suffix: "score" },
  { key: "deadlineWarningDays", label: "Deadline reminder lead time", type: "number", min: 1, max: 30, suffix: "days" },
];

export default async function WorkflowSettingsPage() {
  await requirePageAuth("admin.settings.manage");
  const value = await getSetting("workflow");
  return (
    <SettingsForm
      settingKey="workflow"
      fields={FIELDS}
      initial={value}
      groups={[
        { title: "Approval rules", keys: ["allowSelfApproval", "requireMfaForApproval", "moderatorsCanEditMetadata"] },
        { title: "Question selection", keys: ["reuseCoolOffSessions", "duplicateThreshold"] },
        { title: "Deadlines", keys: ["deadlineWarningDays"] },
      ]}
    />
  );
}
