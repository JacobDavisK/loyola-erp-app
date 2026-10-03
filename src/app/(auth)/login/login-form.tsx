"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { ArrowLeft, AtSign, KeyRound } from "lucide-react";
import { AuthButton, AuthField, AuthHeading, AuthNotice, Divider, PasswordField } from "@/components/auth/fields";
import { SsoButtons } from "@/components/auth/sso-buttons";
import { loginAction } from "@/features/auth/actions";
import { type Locale, translate } from "@/lib/i18n";

/**
 * Progressive sign-in: (1) university ID or e-mail, (2) password, (3) two-step verification when the
 * account has it. The role is worked out from the account after sign-in, so nobody picks one here.
 * Nothing is sent to the server before step 2, so the page never reveals whether an account exists.
 */
export function LoginForm({ notice, ssoError, providers = [], locale = "en", platformName }: { notice?: string; ssoError?: string; providers?: { slug: string; label: string }[]; locale?: Locale; platformName: string }) {
  const t = (x: string) => translate(locale, x);
  const router = useRouter();
  const [step, setStep] = useState<"id" | "password">("id");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(ssoError ?? null);
  const [state, setState] = useState<"idle" | "loading" | "success">("idle");
  const [shake, setShake] = useState(0);
  const [, start] = useTransition();
  const pwRef = useRef<HTMLInputElement>(null);
  const idRef = useRef<HTMLInputElement>(null);

  const fail = (msg: string) => { setError(msg); setShake((n) => n + 1); };

  const toPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) { setFieldError(t("Please enter your university ID or e-mail.")); setShake((n) => n + 1); idRef.current?.focus(); return; }
    setFieldError(null);
    setError(null);
    setStep("password");
    setTimeout(() => pwRef.current?.focus(), 30);
  };

  const signIn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) { setFieldError(t("Please enter your password.")); setShake((n) => n + 1); pwRef.current?.focus(); return; }
    setFieldError(null);
    setError(null);
    setState("loading");
    start(async () => {
      const res = await loginAction({ identifier, password, remember });
      if (!res.ok) {
        setState("idle");
        setPassword("");
        fail(res.error);
        pwRef.current?.focus();
        return;
      }
      if (res.data.next === "mfa") { router.replace("/login/mfa"); return; }
      setState("success");
      setTimeout(() => { router.replace("/dashboard"); router.refresh(); }, 650);
    });
  };

  return (
    <div className={state === "success" ? "auth-fade-out [animation-delay:350ms]" : undefined}>
      <AuthHeading title={t("Welcome back")} subtitle={`${t("Sign in to your")} ${platformName}`} />
      {notice && !error && <AuthNotice>{notice}</AuthNotice>}
      <div aria-live="assertive">{error && <AuthNotice tone="error" id="login-error">{error}</AuthNotice>}</div>

      {step === "id" ? (
        <form key={`id-${shake}`} onSubmit={toPassword} noValidate className={shake ? "auth-shake" : undefined}>
          <AuthField
            ref={idRef}
            id="identifier"
            name="username"
            label={t("University ID or e-mail")}
            icon={AtSign}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            error={fieldError}
          />
          {/* Lets password managers fill both fields from the first step. */}
          <input type="password" name="password" autoComplete="current-password" tabIndex={-1} className="sr-only" aria-hidden value={password} onChange={(e) => setPassword(e.target.value)} />
          <AuthButton type="submit" className="mt-6">{t("Continue")}</AuthButton>
          <div className="mt-5 text-center">
            <Link href="/forgot-password" className="auth-link inline-flex min-h-11 items-center px-1 text-[14px]">{t("Forgot password?")}</Link>
          </div>
          {providers.length > 0 && (
            <>
              <Divider label={t("or")} />
              <SsoButtons providers={providers} label={(p) => `${t("Continue with")} ${p}`} />
            </>
          )}
        </form>
      ) : (
        <form key={`pw-${shake}`} onSubmit={signIn} noValidate className={`auth-step ${shake ? "auth-shake" : ""}`}>
          <div className="mb-6 flex items-center justify-between gap-3 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] py-1.5 pr-1.5 pl-4">
            <span className="min-w-0 truncate text-[14px] text-[var(--text)]" title={identifier}>{identifier}</span>
            <button type="button" onClick={() => { setStep("id"); setPassword(""); setFieldError(null); setError(null); setTimeout(() => idRef.current?.focus(), 30); }}
              className="auth-link inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[10px] px-3 text-[13px]" aria-label={t("Use a different university ID")}>
              <ArrowLeft className="size-3.5" aria-hidden /> {t("Change")}
            </button>
          </div>
          <input type="text" name="username" autoComplete="username" value={identifier} readOnly tabIndex={-1} className="sr-only" aria-hidden />
          <PasswordField
            ref={pwRef}
            id="password"
            name="password"
            label={t("Password")}
            icon={KeyRound}
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldError}
            labelAside={<Link href="/forgot-password" className="auth-link inline-flex min-h-11 items-center px-1 text-[13px]">{t("Forgot password?")}</Link>}
          />
          <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 text-[14px] text-[var(--text-2)]">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-[18px] rounded accent-[var(--brand)]" />
            {t("Remember this device")}
          </label>
          <AuthButton type="submit" className="mt-4" state={state} loadingLabel={t("Signing in…")} successLabel={t("Authentication successful")}>{t("Continue")}</AuthButton>
        </form>
      )}
    </div>
  );
}
