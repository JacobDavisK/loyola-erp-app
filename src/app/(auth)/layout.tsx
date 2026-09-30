import { Lock, ShieldCheck, Stamp } from "lucide-react";
import { connection } from "next/server";
import { Logo } from "@/components/shell/app-shell";
import { db } from "@/server/db";
import { BRAND } from "@/lib/brand";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // Render per request: the institution name comes from the database (editable by admins),
  // and the build must not depend on a running database.
  await connection();
  const inst = await db.institution.findFirst({ select: { name: true, tagline: true } });
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-[oklch(0.2_0.03_265)] text-white lg:flex lg:flex-col">
        <div
          aria-hidden
          className="absolute inset-0 opacity-90"
          style={{
            background:
              "radial-gradient(60% 50% at 20% 15%, oklch(0.45 0.16 262 / 0.55), transparent 70%), radial-gradient(50% 45% at 85% 80%, oklch(0.5 0.13 220 / 0.35), transparent 70%)",
          }}
        />
        <div aria-hidden className="absolute inset-0 bg-[linear-gradient(to_right,oklch(1_0_0/0.04)_1px,transparent_1px),linear-gradient(to_bottom,oklch(1_0_0/0.04)_1px,transparent_1px)] bg-[size:44px_44px] [mask-image:radial-gradient(70%_60%_at_50%_40%,black,transparent)]" />
        <div className="relative flex flex-1 flex-col justify-between p-12">
          <div className="[&_.text-muted-foreground]:text-white/60">
            <Logo />
          </div>
          <div className="max-w-md">
            <div className="mb-6 flex items-center gap-3">
              <UniversityCrest />
              <div>
                <div className="text-sm font-semibold">{inst?.name ?? "Your University"}</div>
                <div className="text-xs text-white/60">{inst?.tagline ?? "Office of the Controller of Examinations"}</div>
              </div>
            </div>
            <h1 className="text-[34px] leading-[1.15] font-semibold tracking-tight">
              The examination lifecycle,
              <br />
              <span className="text-white/60">secured end to end.</span>
            </h1>
            <p className="mt-4 text-[15px] leading-relaxed text-white/70">
              From blueprint to printing package, every question paper is set, moderated, scrutinised and locked in one audited, confidential workflow.
            </p>
            <ul className="mt-8 space-y-3 text-sm text-white/80">
              <li className="flex items-center gap-3"><ShieldCheck className="size-4 text-white/60" /> Role-based access with department scoping</li>
              <li className="flex items-center gap-3"><Stamp className="size-4 text-white/60" /> Tamper-evident audit trail for every decision</li>
              <li className="flex items-center gap-3"><Lock className="size-4 text-white/60" /> Encrypted storage, watermarked, logged exports</li>
            </ul>
          </div>
          <div className="text-xs text-white/40">{BRAND.name} · {BRAND.description}</div>
        </div>
      </aside>
      <main className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[400px]">{children}</div>
      </main>
    </div>
  );
}

function UniversityCrest() {
  return (
    <svg viewBox="0 0 48 48" className="size-11" aria-hidden>
      <path d="M24 3 42 10v13c0 11-7.6 19.4-18 22C13.6 42.4 6 34 6 23V10z" fill="oklch(1 0 0 / 0.1)" stroke="oklch(1 0 0 / 0.55)" strokeWidth="1.5" />
      <path d="M15 20h18M15 25h18M15 30h12" stroke="white" strokeOpacity="0.8" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M24 9l2 3.5 4 .5-3 2.6.8 4L24 17.7 20.2 19.6l.8-4-3-2.6 4-.5z" fill="white" fillOpacity="0.85" />
    </svg>
  );
}
