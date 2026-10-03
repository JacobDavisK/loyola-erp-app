import type { Metadata } from "next";
import { getLocale } from "@/server/i18n";
import { getSetting } from "@/server/services/settings";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Create a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const [{ token }, s, locale] = await Promise.all([searchParams, getSetting("security"), getLocale()]);
  const policy = { minLength: s.passwordMinLength, requireUpper: s.passwordRequireUpper, requireLower: s.passwordRequireLower, requireDigit: s.passwordRequireDigit, requireSymbol: s.passwordRequireSymbol };
  return <ResetForm token={token ?? ""} policy={policy} locale={locale} />;
}
