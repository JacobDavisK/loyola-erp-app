"use client";

import { forwardRef, useState } from "react";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Info, Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/* ───────────────────────── Heading ───────────────────────── */

export function AuthHeading({ title, subtitle, icon: Icon }: { title: string; subtitle?: React.ReactNode; icon?: LucideIcon }) {
  return (
    <div className="mb-8">
      {Icon && <div className="mb-5 grid size-12 place-items-center rounded-[14px] border border-[var(--line)] bg-[var(--surface)] text-[var(--brand)]"><Icon className="size-5" aria-hidden /></div>}
      <h1 className="text-[32px] leading-[1.15] font-semibold 2xl:text-[38px] tracking-[-0.025em] text-[var(--text)]">{title}</h1>
      {subtitle && <p className="mt-2 text-[15px] leading-relaxed text-[var(--text-2)]">{subtitle}</p>}
    </div>
  );
}

/* ───────────────────────── Field ───────────────────────── */

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & { label: string; icon?: LucideIcon; error?: string | null; trailing?: React.ReactNode; labelAside?: React.ReactNode };

/** A labelled input with an optional leading icon, a trailing control and an accessible error message. */
export const AuthField = forwardRef<HTMLInputElement, FieldProps>(function AuthField({ label, icon: Icon, error, trailing, labelAside, id, className, ...rest }, ref) {
  const errId = `${id}-error`;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-[14px] font-medium text-[var(--text)]">{label}</label>
        {labelAside}
      </div>
      <div className="relative">
        {Icon && <Icon className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-[var(--text-3)]" aria-hidden />}
        <input ref={ref} id={id} aria-invalid={error ? true : undefined} aria-describedby={error ? errId : undefined} className={cn("auth-input", !Icon && "no-icon", trailing ? "pr-12" : undefined, className)} {...rest} />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
      {error && <p id={errId} className="flex items-center gap-1.5 text-[13px] text-[var(--danger)]"><AlertCircle className="size-3.5 shrink-0" aria-hidden /> {error}</p>}
    </div>
  );
});

export const PasswordField = forwardRef<HTMLInputElement, Omit<FieldProps, "type" | "trailing">>(function PasswordField(props, ref) {
  const [show, setShow] = useState(false);
  return (
    <AuthField
      ref={ref}
      type={show ? "text" : "password"}
      {...props}
      trailing={
        <button type="button" onClick={() => setShow((s) => !s)} aria-pressed={show} aria-label={show ? "Hide password" : "Show password"} aria-controls={props.id}
          className="grid size-11 place-items-center rounded-[10px] text-[var(--text-3)] outline-none transition-colors hover:text-[var(--text)] focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--brand)_30%,transparent)]">
          {show ? <EyeOff className="size-[18px]" aria-hidden /> : <Eye className="size-[18px]" aria-hidden />}
        </button>
      }
    />
  );
});

/* ───────────────────────── Buttons and notices ───────────────────────── */

export function AuthButton({ state = "idle", children, loadingLabel, successLabel, variant = "primary", className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { state?: "idle" | "loading" | "success"; loadingLabel?: string; successLabel?: string; variant?: "primary" | "quiet" }) {
  return (
    <button {...rest} data-state={state} aria-busy={state === "loading" || undefined} disabled={rest.disabled || state !== "idle"} className={cn("auth-btn", variant === "primary" ? "auth-btn-primary" : "auth-btn-quiet", className)}>
      {state === "loading" ? <><Loader2 className="size-4 animate-spin" aria-hidden /> {loadingLabel ?? children}</>
        : state === "success" ? <><CheckCircle2 className="size-[18px]" aria-hidden /> {successLabel ?? children}</>
        : children}
    </button>
  );
}

export function AuthNotice({ tone = "info", children, id }: { tone?: "info" | "error"; children: React.ReactNode; id?: string }) {
  const Icon = tone === "error" ? AlertCircle : Info;
  return (
    <div id={id} role={tone === "error" ? "alert" : "status"} className={cn("mb-6 flex items-start gap-2.5 rounded-[12px] border px-4 py-3 text-[14px] leading-snug", tone === "error" ? "border-[color-mix(in_oklab,var(--danger)_25%,var(--line))] bg-[var(--danger-bg)] text-[var(--danger)]" : "border-[var(--line)] bg-[var(--info-bg)] text-[var(--text-2)]")}>
      <Icon className="mt-px size-4 shrink-0" aria-hidden /> <span>{children}</span>
    </div>
  );
}

export function Divider({ label }: { label: string }) {
  return (
    <div className="my-6 flex items-center gap-4 text-[12px] font-medium tracking-[0.08em] text-[var(--text-3)] uppercase" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-[var(--line)]" />{label}<span className="h-px flex-1 bg-[var(--line)]" />
    </div>
  );
}
