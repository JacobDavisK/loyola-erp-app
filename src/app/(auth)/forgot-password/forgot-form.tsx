"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ArrowLeft, AtSign, MailCheck } from "lucide-react";
import { AuthButton, AuthField, AuthHeading } from "@/components/auth/fields";
import { AuthSteps } from "@/components/auth/steps";
import { requestPasswordResetAction } from "@/features/auth/actions";
import { type Locale, translate } from "@/lib/i18n";

/** Recovery steps 1–2: identify the account, then verify by the link sent to its registered e-mail. */
export function ForgotForm({ locale = "en" }: { locale?: Locale }) {
  const t = (x: string) => translate(locale, x);
  const [id, setId] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [pending, start] = useTransition();
  const steps = [t("Identify"), t("Verify"), t("New password")];
  const back = <Link href="/login" className="auth-link mt-6 inline-flex min-h-11 items-center gap-1.5 px-1 text-[14px]"><ArrowLeft className="size-3.5" aria-hidden /> {t("Back to sign in")}</Link>;

  if (sent) {
    return (
      <div className="auth-step">
        <AuthSteps steps={steps} current={1} />
        <AuthHeading icon={MailCheck} title={t("Check your e-mail")} subtitle={<>{t("If an account matches")} <span className="font-medium text-[var(--text)]">{id}</span>, {t("a secure link has been sent to its registered e-mail address. The link works for 30 minutes.")}</>} />
        <AuthButton variant="quiet" type="button" state={pending ? "loading" : "idle"} onClick={() => start(async () => { await requestPasswordResetAction(id); })} loadingLabel={t("Sending…")}>{t("Send the link again")}</AuthButton>
        {back}
      </div>
    );
  }
  return (
    <div>
      <AuthSteps steps={steps} current={0} />
      <AuthHeading title={t("Forgot your password?")} subtitle={t("Enter your university ID or e-mail and we will send you a link to choose a new one.")} />
      <form key={shake} className={shake ? "auth-shake" : undefined} noValidate onSubmit={(e) => {
        e.preventDefault();
        if (!id.trim()) { setError(t("Please enter your university ID or e-mail.")); setShake((n) => n + 1); return; }
        setError(null);
        start(async () => { await requestPasswordResetAction(id); setSent(true); });
      }}>
        <AuthField id="recover-id" name="username" label={t("University ID or e-mail")} icon={AtSign} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus value={id} onChange={(e) => setId(e.target.value)} error={error} />
        <AuthButton type="submit" className="mt-6" state={pending ? "loading" : "idle"} loadingLabel={t("Sending…")}>{t("Send reset link")}</AuthButton>
      </form>
      {back}
    </div>
  );
}
