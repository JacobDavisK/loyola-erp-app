import type { Branding } from "@/lib/branding";
import { cn } from "@/lib/utils";

/** The institution's logo at its own aspect ratio, or a quiet monogram when none is configured. */
export function BrandLogo({ branding, className }: { branding: Pick<Branding, "logoUrl" | "shortName" | "universityName">; className?: string }) {
  if (branding.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- configured per installation; may be any origin
    return <img src={branding.logoUrl} alt={`${branding.universityName} logo`} className={cn("h-9 w-auto max-w-[160px] object-contain", className)} />;
  }
  return (
    <span
      aria-hidden
      className={cn("grid size-9 place-items-center rounded-[10px] border border-[var(--line-strong)] bg-[var(--surface)] text-[13px] font-semibold tracking-tight text-[var(--brand)] shadow-[0_1px_2px_rgb(0_0_0/0.04)]", className)}
    >
      {branding.shortName.slice(0, 3)}
    </span>
  );
}
