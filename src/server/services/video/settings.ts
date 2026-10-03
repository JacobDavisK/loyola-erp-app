import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { type AuthContext, can, isSuperAdmin } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { getSetting, SETTING_SCHEMAS } from "@/server/services/settings";

/**
 * Settings → Video & collaboration. Two levels: meeting types and everyday defaults
 * (video.manage_settings), and institution-wide limits, recording, retention and guest access
 * (video.manage_global_settings). Each person can only change the keys of their level.
 */
const DEFAULT_KEYS = ["enabledTypes", "defaultDurationMinutes", "joinEarlyMinutes", "lobbyDefault", "chatDefault", "screenShareDefault", "reminderMinutes", "recordingAccessDefault"] as const;
const GLOBAL_KEYS = ["maxDurationMinutes", "maxParticipants", "recordingEnabled", "recordingRetentionDays", "allowRecordingDownload", "attendancePresentPercent", "attendancePartialMinMinutes", "guestAccessEnabled", "guestGraceHours", "chatRetentionDays"] as const;

export function videoSettingsAccess(ctx: AuthContext) {
  const global = isSuperAdmin(ctx) || can(ctx, "video.manage_global_settings");
  return { defaults: global || can(ctx, "video.manage_settings"), global };
}

export async function saveVideoSettings(ctx: AuthContext, raw: unknown) {
  const access = videoSettingsAccess(ctx);
  if (!access.defaults) throw forbidden();
  const input = (raw ?? {}) as Record<string, unknown>;
  const current = await getSetting("video");
  const next: Record<string, unknown> = { ...current };
  for (const k of DEFAULT_KEYS) if (k in input) next[k] = input[k];
  if (access.global) for (const k of GLOBAL_KEYS) if (k in input) next[k] = input[k];
  const value = SETTING_SCHEMAS.video.parse(next);
  if (value.defaultDurationMinutes > value.maxDurationMinutes) value.defaultDurationMinutes = value.maxDurationMinutes;
  await db.systemSetting.upsert({ where: { key: "video" }, create: { key: "video", value: value as Prisma.InputJsonValue, updatedById: ctx.user.id }, update: { value: value as Prisma.InputJsonValue, updatedById: ctx.user.id } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "settings.video.update", resourceType: "settings", resourceId: "video", oldValue: current, newValue: value });
}
