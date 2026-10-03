"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, KeyRound } from "lucide-react";
import { AuthButton, AuthHeading, AuthNotice, PasswordField } from "@/components/auth/fields";
import { PasswordStrength, type PolicyView, requirementsFor } from "@/components/auth/password-strength";
import { AuthSteps } from "@/components/auth/steps";
import { resetPasswordAction } from "@/features/auth/actions";
import { type Locale, translate } from "@/lib/i18n";

/** Recovery step 3: choose a new password, with live strength and the institution's requirements. */
export function ResetForm({ token, policy, locale = "en" }: { token: string; policy: PolicyView; locale?: Locale }) {
  const t = (x: string) => translate(locale, x);
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(token ? null : t("This reset link is incomplete. Request a new one."));
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "success">("idle");
  const [shake, setShake] = useState(0);
  const [, start] = useTransition();
  const meets = requirementsFor(policy).every((r) => r.test(pw));

  return (
    <div className={state === "success" ? "auth-fade-out [animation-delay:350ms]" : undefined}>
      <AuthSteps steps={[t("Identify"), t("Verify"), t("New password")]} current={2} />
      <AuthHeading title={t("Create a new password")} subtitle={t("Choose a password you do not use anywhere else. Avoid your name or university ID.")} />
      <div aria-live="assertive">{error && <AuthNotice tone="error">{error}</AuthNotice>}</div>
      <form key={shake} className={shake ? "auth-shake" : undefined} noValidate onSubmit={(e) => {
        e.preventDefault();
        if (pw !== confirm) { setConfirmError(t("The passwords do not match.")); setShake((n) => n + 1); return; }
        setConfirmError(null);
        setError(null);
        setState("loading");
        start(async () => {
          const res = await resetPasswordAction(token, pw);
          if (!res.ok) { setState("idle"); setError(res.error); setShake((n) => n + 1); return; }
          setState("success");
          setTimeout(() => router.replace("/login?reset=1"), 700);
        });
      }}>
        <div className="space-y-5">
          <PasswordField id="new-password" name="new-password" label={t("New password")} icon={KeyRound} autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
          <PasswordStrength password={pw} policy={policy} />
          <PasswordField id="confirm-password" name="confirm-password" label={t("Confirm new password")} icon={KeyRound} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={confirmError} />
        </div>
        <AuthButton type="submit" className="mt-6" state={state} disabled={!token || !meets || !confirm} loadingLabel={t("Saving…")} successLabel={t("Password updated")}>{t("Update password")}</AuthButton>
      </form>
      <Link href="/login" className="auth-link mt-6 inline-flex min-h-11 items-center gap-1.5 px-1 text-[14px]"><ArrowLeft className="size-3.5" aria-hidden /> {t("Back to sign in")}</Link>
    </div>
  );
}
