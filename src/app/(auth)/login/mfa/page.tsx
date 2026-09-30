import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSession } from "@/server/auth/session";
import { MfaForm } from "./mfa-form";

export const metadata: Metadata = { title: "Verify sign-in" };

export default async function MfaPage() {
  const session = await readSession();
  if (!session) redirect("/login?expired=1");
  if (!session.mfaPending) redirect("/dashboard");
  return <MfaForm />;
}
