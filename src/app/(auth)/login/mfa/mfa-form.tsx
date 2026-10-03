"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { AuthButton, AuthHeading, AuthNotice } from "@/components/auth/fields";
import { OtpInput } from "@/components/auth/otp-input";
import { cancelMfaChallengeAction, verifyMfaAction } from "@/features/auth/actions";
import { type Locale, translate } from "@/lib/i18n";

/** Step 3: the six-digit code from the person's authenticator app. Submits by itself once all six are in. */
export function MfaForm({ locale = "en", supportHref }: { locale?: Locale; supportHref: string }) {
  const t = (x: string) => translate(locale, x);
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "success">("idle");
  const [attempt, setAttempt] = useState(0);
  const [, start] = useTransition();

  const verify = (value: string) => {
    if (value.length !== 6 || state !== "idle") return;
    setError(null);
    setState("loading");
    start(async () => {
      const res = await verifyMfaAction(value);
      if (!res.ok) {
        setState("idle");
        setError(res.error);
        setCode("");
        setAttempt((n) => n + 1);
        return;
      }
      setState("success");
      setTimeout(() => { router.replace("/dashboard"); router.refresh(); }, 650);
    });
  };

  return (
    <div className={state === "success" ? "auth-fade-out [animation-delay:350ms]" : undefined}>
      <AuthHeading icon={ShieldCheck} title={t("Verify your identity")} subtitle={t("Enter the 6-digit code from the authenticator app on your registered device.")} />
      <div aria-live="assertive">{error && <AuthNotice tone="error">{error}</AuthNotice>}</div>
      <form onSubmit={(e) => { e.preventDefault(); verify(code); }} noValidate>
        <div key={attempt} className={attempt ? "auth-shake" : undefined}>
          <OtpInput value={code} onChange={setCode} onComplete={verify} invalid={!!error} disabled={state !== "idle"} describedBy="otp-help" label={t("Verification code")} />
        </div>
        <p id="otp-help" className="mt-3 text-[13px] text-[var(--text-3)]">{t("A new code appears in your app every 30 seconds.")}</p>
        <AuthButton type="submit" className="mt-6" state={state} disabled={code.length !== 6} loadingLabel={t("Verifying…")} successLabel={t("Authentication successful")}>{t("Verify")}</AuthButton>
      </form>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-[14px]">
        <form action={cancelMfaChallengeAction}>
          <button type="submit" className="auth-link inline-flex min-h-11 items-center gap-1.5 px-1"><ArrowLeft className="size-3.5" aria-hidden /> {t("Use a different account")}</button>
        </form>
        <a href={supportHref} className="auth-link inline-flex min-h-11 items-center px-1">{t("Lost your device?")}</a>
      </div>
    </div>
  );
}
