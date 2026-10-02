import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { demoModeEnabled } from "@/server/env";
import { getLocale } from "@/server/i18n";
import { enabledProviders } from "@/server/services/sso";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await getAuth()) redirect("/dashboard");
  const sp = await searchParams;
  let demoUsers: { email: string; name: string; role: string }[] = [];
  if (demoModeEnabled) {
    const users = await db.user.findMany({
      where: { email: { endsWith: "@example.edu" }, deletedAt: null, status: "ACTIVE" },
      include: { roles: { include: { role: true } } },
      orderBy: { employeeId: "asc" },
    });
    const wanted = ["SUPER_ADMIN", "EXAM_CONTROLLER", "DEPUTY_CONTROLLER", "EXAM_CELL_STAFF", "HOD", "SETTER", "MODERATOR", "SCRUTINY_OFFICER", "APPROVER", "AUDITOR"];
    for (const key of wanted) {
      const u = users.find((x) => x.roles.some((r) => r.role.key === key) && !demoUsers.some((d) => d.email === x.email));
      if (u) demoUsers.push({ email: u.email, name: u.name, role: u.roles.find((r) => r.role.key === key)!.role.name });
    }
    demoUsers = demoUsers.slice(0, 10);
  }
  const providers = (await enabledProviders()).map((p) => ({ slug: p.kind.toLowerCase(), label: p.label }));
  return <LoginForm demoUsers={demoUsers} providers={providers} locale={await getLocale()} ssoError={sp.sso_error ? (await cookies()).get("examcore_sso_msg")?.value?.slice(0, 200) ?? "Single sign-on did not complete." : undefined} notice={sp.signedOut ? "You have been signed out." : sp.reset ? "Password updated. Sign in with your new password." : sp.expired ? "Your session expired. Please sign in again." : undefined} />;
}
