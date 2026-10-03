import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { supportHref } from "@/lib/branding";
import { readSession } from "@/server/auth/session";
import { getBranding } from "@/server/branding";
import { getLocale } from "@/server/i18n";
import { MfaForm } from "./mfa-form";

export const metadata: Metadata = { title: "Verify your identity" };

export default async function MfaPage() {
  const session = await readSession();
  if (!session) redirect("/login?expired=1");
  if (!session.mfaPending) redirect("/dashboard");
  const [branding, locale] = await Promise.all([getBranding(), getLocale()]);
  return <MfaForm locale={locale} supportHref={supportHref(branding.supportContact)} />;
}
