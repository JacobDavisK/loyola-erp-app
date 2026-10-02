"use client";

import { LanguageSwitcher } from "@/components/language-switcher";
import { type Locale, translate } from "@/lib/i18n";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, ArrowRight, Eye, EyeOff, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction } from "@/features/auth/actions";

const schema = z.object({
  identifier: z.string().trim().min(1, "Enter your e-mail or employee ID"),
  password: z.string().min(1, "Enter your password"),
  remember: z.boolean(),
});
type Values = z.infer<typeof schema>;

export function LoginForm({ notice, ssoError, providers = [], locale = "en" }: { notice?: string; ssoError?: string; providers?: { slug: string; label: string }[]; locale?: Locale }) {
  const t = (x: string) => translate(locale, x);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [pending, start] = useTransition();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { identifier: "", password: "", remember: false } });

  const onSubmit = form.handleSubmit((values) =>
    start(async () => {
      setError(null);
      const res = await loginAction(values);
      if (!res.ok) {
        setError(res.error);
        form.setValue("password", "");
        form.setFocus("password");
        return;
      }
      router.replace(res.data.next === "mfa" ? "/login/mfa" : "/dashboard");
      router.refresh();
    }),
  );

  return (
    <div>
      <div className="flex items-start justify-between gap-3"><h2 className="text-[34px] leading-none">{t("Sign in")}</h2><LanguageSwitcher current={locale} label={t("Language")} /></div>

      {notice && (
        <div role="status" className="mt-6 flex items-start gap-2 rounded-lg border bg-muted/50 px-3 py-2.5 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-tone-info" /> {notice}
        </div>
      )}
      {(error || ssoError) && (
        <div role="alert" className="mt-6 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error ?? ssoError}
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-8 space-y-6" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="identifier">{t("E-mail or employee ID")}</Label>
          <Input
            id="identifier"
            autoComplete="username"
            autoFocus
            className="h-10"
            aria-invalid={!!form.formState.errors.identifier}
            aria-describedby={form.formState.errors.identifier ? "identifier-error" : undefined}
            {...form.register("identifier")}
          />
          {form.formState.errors.identifier && <p id="identifier-error" className="text-xs text-destructive">{form.formState.errors.identifier.message}</p>}
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">{t("Password")}</Label>
            <Link href="/forgot-password" className="text-xs font-medium text-primary hover:underline">{t("Forgot password?")}</Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              className="h-10 pr-10"
              aria-invalid={!!form.formState.errors.password}
              aria-describedby={form.formState.errors.password ? "password-error" : undefined}
              {...form.register("password")}
            />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground" aria-label={show ? "Hide password" : "Show password"}>
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {form.formState.errors.password && <p id="password-error" className="text-xs text-destructive">{form.formState.errors.password.message}</p>}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={form.watch("remember")} onCheckedChange={(v) => form.setValue("remember", v === true)} />
          {t("Remember this device")}
        </label>
        <Button type="submit" className="h-11 w-full" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {t("Sign in")} <ArrowRight />
        </Button>
      </form>

      {providers.length > 0 && (
        <div className="mt-5 space-y-2">
          <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />{t("or")}<span className="h-px flex-1 bg-border" /></div>
          {providers.map((p) => (
            <Button key={p.slug} asChild variant="outline" className="h-10 w-full">
              <a href={`/api/auth/sso/${p.slug}${form.watch("remember") ? "?remember=1" : ""}`}>{t("Continue with")} {p.label}</a>
            </Button>
          ))}
        </div>
      )}

    </div>
  );
}
