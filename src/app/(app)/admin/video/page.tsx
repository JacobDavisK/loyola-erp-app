import type { Metadata } from "next";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { type SettingField, SettingsForm } from "@/features/admin/settings-form";
import { saveVideoSettingsAction } from "@/features/video/actions";
import { MEETING_TYPES } from "@/lib/domain/video";
import { requirePageAuth } from "@/server/auth/current";
import { env } from "@/server/env";
import { getSetting } from "@/server/services/settings";
import { videoSettingsAccess } from "@/server/services/video/settings";
import { recordingStorage } from "@/server/video/recording-storage";
import { videoProvider } from "@/server/video/provider";

export const metadata: Metadata = { title: "Video & collaboration" };

export default async function VideoSettingsPage() {
  const ctx = await requirePageAuth(["video.manage_settings", "video.manage_global_settings"]);
  const access = videoSettingsAccess(ctx);
  const [value, provider] = await Promise.all([getSetting("video"), videoProvider()]);
  const health = provider.configured ? await provider.health() : null;
  const storage = recordingStorage();
  const g = !access.global;
  const fields: SettingField[] = [
    { key: "enabledTypes", label: "Meeting types people can schedule", type: "multi", options: Object.entries(MEETING_TYPES).map(([value, t]) => ({ value, label: t.label })) },
    { key: "defaultDurationMinutes", label: "Default duration (minutes)", type: "number", min: 10, max: 480 },
    { key: "joinEarlyMinutes", label: "Participants can join this many minutes early", type: "number", min: 0, max: 60 },
    { key: "reminderMinutes", label: "Reminder before start (minutes, 0 = off)", type: "number", min: 0, max: 120 },
    { key: "lobbyDefault", label: "Waiting room on by default", type: "boolean" },
    { key: "chatDefault", label: "Chat on by default", type: "boolean" },
    { key: "screenShareDefault", label: "Participant screen sharing on by default", type: "boolean" },
    { key: "recordingAccessDefault", label: "Who can watch recordings (default)", type: "select", options: [
      { value: "HOST_ONLY", label: "Host only" }, { value: "PARTICIPANTS", label: "Participants" }, { value: "COURSE", label: "Course members" }, { value: "DEPARTMENT", label: "Department" }, { value: "ADMINS", label: "Administrators" },
    ] },
    { key: "maxDurationMinutes", label: "Longest allowed meeting (minutes)", type: "number", min: 15, max: 720, readOnly: g },
    { key: "maxParticipants", label: "Most participants per meeting", type: "number", min: 2, max: 1000, readOnly: g },
    { key: "recordingEnabled", label: "Allow recording", type: "boolean", readOnly: g },
    { key: "allowRecordingDownload", label: "Allow recording downloads", type: "boolean", readOnly: g },
    { key: "recordingRetentionDays", label: "Delete recordings after (days)", type: "number", min: 1, max: 3650, readOnly: g },
    { key: "chatRetentionDays", label: "Delete meeting chat after (days)", type: "number", min: 1, max: 3650, readOnly: g },
    { key: "attendancePresentPercent", label: "Present at or above (% of the meeting)", type: "number", min: 1, max: 100, readOnly: g },
    { key: "attendancePartialMinMinutes", label: "Partially present from (minutes)", type: "number", min: 0, max: 120, readOnly: g },
    { key: "guestAccessEnabled", label: "Allow guest links (external examiners, speakers)", type: "boolean", readOnly: g },
    { key: "guestGraceHours", label: "Guest links stop working this many hours after the end", type: "number", min: 0, max: 72, readOnly: g },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Video & collaboration" breadcrumbs={[{ label: "Configuration centre", href: "/admin" }, { label: "Video & collaboration" }]} description="Live classes, meetings, vivas and webinars run on the university's own OpenVidu server. Connection details live in the server environment, never in the database." />
      <Section title="Video service">
        <KeyValue items={[
          ["Provider", provider.configured ? "OpenVidu" : "Not configured — set VIDEO_PROVIDER=openvidu, OPENVIDU_URL, OPENVIDU_API_KEY and OPENVIDU_API_SECRET (docs/openvidu-setup.md)"],
          ["Server", provider.configured ? env.OPENVIDU_URL ?? "—" : "—"],
          ["Status", health ? (health.ok ? `Connected (${health.latencyMs} ms)` : `Not responding${health.detail ? ` — ${health.detail}` : ""}`) : "—"],
          ["Recording storage", storage.configured ? "S3-compatible storage configured" : "Not configured — recordings cannot be played back"],
        ]} />
      </Section>
      {!access.global && <p className="text-sm text-muted-foreground">Limits, recording, retention, attendance and guest settings are institution-wide and can be changed only by IT administrators.</p>}
      <SettingsForm
        settingKey="video" fields={fields} initial={value} save={saveVideoSettingsAction}
        groups={[
          { title: "Scheduling", keys: ["enabledTypes", "defaultDurationMinutes", "joinEarlyMinutes", "reminderMinutes"] },
          { title: "Meeting defaults", keys: ["lobbyDefault", "chatDefault", "screenShareDefault", "recordingAccessDefault"] },
          { title: "Limits", keys: ["maxDurationMinutes", "maxParticipants"] },
          { title: "Recording & retention", keys: ["recordingEnabled", "allowRecordingDownload", "recordingRetentionDays", "chatRetentionDays"] },
          { title: "Attendance", keys: ["attendancePresentPercent", "attendancePartialMinMinutes"] },
          { title: "Guests", keys: ["guestAccessEnabled", "guestGraceHours"] },
        ]}
      />
    </div>
  );
}
