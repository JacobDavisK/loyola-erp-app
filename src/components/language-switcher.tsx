"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Languages } from "lucide-react";
import { toast } from "sonner";
import { setLocaleAction } from "@/features/shell/actions";
import { LOCALES, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** A compact language picker (English / தமிழ் / हिन्दी). */
export function LanguageSwitcher({ current, className, label = "Language" }: { current: Locale; className?: string; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <Languages className="size-3.5" aria-hidden />
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        className="h-7 rounded-md border bg-card px-1.5 text-xs text-foreground"
        value={current}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          start(async () => {
            const r = await setLocaleAction(next);
            if (!r.ok) toast.error(r.error);
            router.refresh();
          });
        }}
      >
        {(Object.keys(LOCALES) as Locale[]).map((l) => <option key={l} value={l} lang={l}>{LOCALES[l]}</option>)}
      </select>
    </label>
  );
}
