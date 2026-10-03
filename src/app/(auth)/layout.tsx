import { connection } from "next/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { getBranding } from "@/server/branding";
import { getLocale } from "@/server/i18n";
import "./auth.css";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // Render per request: branding comes from the database and environment, and the build must not need a database.
  await connection();
  const [branding, locale] = await Promise.all([getBranding(), getLocale()]);
  return <AuthShell branding={branding} locale={locale}>{children}</AuthShell>;
}
