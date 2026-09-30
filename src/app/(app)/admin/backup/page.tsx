import type { Metadata } from "next";
import { BackupPanel } from "@/features/admin/backup-panel";
import { requirePageAuth } from "@/server/auth/current";

export const metadata: Metadata = { title: "Backup" };

export default async function BackupPage() {
  await requirePageAuth("admin.backup");
  return <BackupPanel />;
}
