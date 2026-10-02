import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth/current";
import { getLocale } from "@/server/i18n";
import { enabledProviders } from "@/server/services/sso";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await getAuth()) redirect("/dashboard");
  const sp = await searchParams;
  const providers = (await enabledProviders()).map((p) => ({ slug: p.kind.toLowerCase(), label: p.label }));
  return <LoginForm providers={providers} locale={await getLocale()} ssoError={sp.sso_error ? (await cookies()).get("examcore_sso_msg")?.value?.slice(0, 200) ?? "Single sign-on did not complete." : undefined} notice={sp.signedOut ? "You have been signed out." : sp.reset ? "Password updated. Sign in with your new password." : sp.expired ? "Your session expired. Please sign in again." : undefined} />;
}
