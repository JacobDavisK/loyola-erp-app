import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { translate } from "@/lib/i18n";
import { getAuth } from "@/server/auth/current";
import { getBranding } from "@/server/branding";
import { getLocale } from "@/server/i18n";
import { enabledProviders } from "@/server/services/sso";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await getAuth()) redirect("/dashboard");
  const sp = await searchParams;
  const [locale, branding, sso] = await Promise.all([getLocale(), getBranding(), enabledProviders()]);
  const t = (s: string) => translate(locale, s);
  // Microsoft first, then Google, as institutions most often use Microsoft 365.
  const providers = sso.sort((a, b) => (a.kind === "MICROSOFT" ? -1 : b.kind === "MICROSOFT" ? 1 : 0)).map((p) => ({ slug: p.kind.toLowerCase(), label: p.label }));
  const notice = sp.signedOut ? t("You have been signed out.") : sp.reset ? t("Your password was updated. Sign in with your new password.") : sp.expired ? t("Your session has expired. Please sign in again.") : undefined;
  const ssoError = sp.sso_error ? (await cookies()).get("examcore_sso_msg")?.value?.slice(0, 200) ?? t("Single sign-on did not complete. Please try again.") : undefined;
  return <LoginForm providers={providers} locale={locale} platformName={branding.platformName} notice={notice} ssoError={ssoError} />;
}
