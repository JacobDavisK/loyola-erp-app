import type { Metadata } from "next";
import { getLocale } from "@/server/i18n";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Forgot your password?" };

export default async function ForgotPasswordPage() {
  return <ForgotForm locale={await getLocale()} />;
}
