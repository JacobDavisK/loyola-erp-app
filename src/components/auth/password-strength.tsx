"use client";

import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PolicyView { minLength: number; requireUpper: boolean; requireLower: boolean; requireDigit: boolean; requireSymbol: boolean }

export function requirementsFor(policy: PolicyView) {
  return [
    { label: `At least ${policy.minLength} characters`, test: (p: string) => p.length >= policy.minLength },
    ...(policy.requireUpper ? [{ label: "An uppercase letter", test: (p: string) => /[A-Z]/.test(p) }] : []),
    ...(policy.requireLower ? [{ label: "A lowercase letter", test: (p: string) => /[a-z]/.test(p) }] : []),
    ...(policy.requireDigit ? [{ label: "A number", test: (p: string) => /\d/.test(p) }] : []),
    ...(policy.requireSymbol ? [{ label: "A symbol", test: (p: string) => /[^A-Za-z0-9]/.test(p) }] : []),
  ];
}

/** 0–4: length, variety, and no long repeats. */
export function strengthOf(p: string): number {
  if (!p) return 0;
  let s = 0;
  if (p.length >= 12) s++;
  if (p.length >= 16) s++;
  if ([/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length >= 3) s++;
  if (!/(.)\1{2,}/.test(p) && new Set(p).size >= Math.min(10, p.length * 0.6)) s++;
  return s;
}

const LABELS = ["Too weak", "Weak", "Fair", "Good", "Strong"];

export function PasswordStrength({ password, policy }: { password: string; policy: PolicyView }) {
  const score = strengthOf(password);
  const reqs = requirementsFor(policy);
  return (
    <div className="space-y-3" aria-live="polite">
      <div className="flex items-center gap-3">
        <div className="grid flex-1 grid-cols-4 gap-1.5" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={cn("h-1.5 rounded-full transition-colors duration-200", i < score ? (score <= 1 ? "bg-[var(--danger)]" : score === 2 ? "bg-amber-500" : "bg-emerald-500") : "bg-[var(--line)]")} />
          ))}
        </div>
        <span className="w-16 text-right text-[12px] font-medium text-[var(--text-2)]">{password ? LABELS[score] : ""}</span>
      </div>
      <ul className="grid gap-1.5 text-[13px] sm:grid-cols-2">
        {reqs.map((r) => {
          const ok = r.test(password);
          return (
            <li key={r.label} className={cn("flex items-center gap-2 transition-colors", ok ? "text-[var(--text)]" : "text-[var(--text-3)]")}>
              {ok ? <Check className="size-3.5 text-emerald-500" aria-hidden /> : <Circle className="size-3 opacity-60" aria-hidden />}
              {r.label}<span className="sr-only">{ok ? " — done" : " — not yet"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
