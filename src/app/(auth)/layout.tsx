import { connection } from "next/server";
import { db } from "@/server/db";
import { BRAND } from "@/lib/brand";
import { cmuMono, cmuSerif } from "./fonts";
import "./auth.css";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // Render per request: the institution name comes from the database (editable by admins),
  // and the build must not depend on a running database.
  await connection();
  const inst = await db.institution.findFirst({ select: { name: true } });
  const name = inst?.name ?? BRAND.tagline;
  const [first, ...rest] = name.split(" of ");
  return (
    <div className={`auth-root ${cmuSerif.variable} ${cmuMono.variable} relative min-h-screen overflow-hidden`}>
      <div aria-hidden className="auth-stars pointer-events-none absolute inset-0 opacity-70" />
      <Globe className="pointer-events-none absolute top-1/2 left-1/2 w-[min(150vw,880px)] -translate-x-1/2 -translate-y-1/2 opacity-40 lg:left-[30%] lg:w-[min(64vw,900px)] lg:opacity-100" />

      <div className="relative mx-auto grid min-h-screen max-w-[1400px] items-center gap-10 px-5 py-10 sm:px-10 lg:grid-cols-[1.15fr_minmax(0,440px)] lg:gap-16 lg:px-16">
        <header className="auth-rise text-center lg:text-left">
          <div className="auth-smallcaps text-[13px] tracking-[0.32em] text-[var(--gold-soft)]">{BRAND.name}</div>
          <h1 className="mt-5 text-[clamp(44px,8vw,104px)] leading-[0.95] font-normal text-[#f6efe0] [text-shadow:0_2px_30px_#0008]">
            {rest.length ? (
              <>
                {first}
                <span className="mt-2 block text-[0.62em] italic text-[var(--gold-soft)]">of {rest.join(" of ")}</span>
              </>
            ) : name}
          </h1>
          <div aria-hidden className="mx-auto mt-8 flex max-w-[22rem] items-center gap-3 lg:mx-0">
            <span className="h-px flex-1 bg-gradient-to-r from-transparent via-[var(--gold)] to-transparent lg:from-[var(--gold)]" />
            <span className="font-[family-name:var(--font-cmu-mono)] text-[12px] tracking-[0.2em] text-[#f2ecdf99]">φ 0°00′ · λ 0°00′</span>
            <span className="h-px flex-1 bg-gradient-to-l from-transparent via-[var(--gold)] to-transparent lg:hidden" />
          </div>
        </header>

        <main className="auth-rise auth-rise-2 w-full max-w-[440px] justify-self-center lg:justify-self-end">
          <div className="auth-card relative rounded-[3px] px-7 pt-7 pb-8 sm:px-10 sm:pt-9 sm:pb-10">
            <div aria-hidden className="auth-rule mb-7" />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

/** A slowly turning wire-frame globe, tilted on Earth's axis, with one gold satellite. */
function Globe({ className }: { className?: string }) {
  const c = 250, r = 200;
  const lats = [-60, -40, -20, 0, 20, 40, 60];
  const meridians = 8;
  return (
    <svg viewBox="0 0 500 500" className={className} aria-hidden>
      <defs>
        <radialGradient id="globe-fill" cx="38%" cy="32%" r="75%">
          <stop offset="0%" stopColor="#3b4f9a" stopOpacity="0.55" />
          <stop offset="60%" stopColor="#141c42" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#05081a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="globe-halo" cx="50%" cy="50%" r="50%">
          <stop offset="70%" stopColor="#d4ad62" stopOpacity="0" />
          <stop offset="86%" stopColor="#d4ad62" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#d4ad62" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={c} cy={c} r={r + 34} fill="url(#globe-halo)" className="globe-glow" />
      <g transform={`rotate(-23.4 ${c} ${c})`} fill="none">
        <circle cx={c} cy={c} r={r} fill="url(#globe-fill)" stroke="#e9cf98" strokeOpacity="0.55" strokeWidth="1.1" />
        {lats.map((lat) => {
          const rad = (lat * Math.PI) / 180;
          const rx = r * Math.cos(rad);
          return <ellipse key={lat} cx={c} cy={c - r * Math.sin(rad)} rx={rx} ry={rx * 0.14} stroke="#f2ecdf" strokeOpacity={lat === 0 ? 0.5 : 0.22} strokeWidth={lat === 0 ? 1 : 0.7} />;
        })}
        {Array.from({ length: meridians }, (_, i) => (
          <ellipse key={i} className="globe-meridian" style={{ animationDelay: `${-(i * 24) / (2 * meridians)}s` }} cx={c} cy={c} rx={r} ry={r} stroke="#f2ecdf" strokeOpacity="0.26" strokeWidth="0.7" />
        ))}
        <line x1={c} y1={c - r - 26} x2={c} y2={c + r + 26} stroke="#e9cf98" strokeOpacity="0.45" strokeWidth="0.8" strokeDasharray="2 5" />
      </g>
      <g transform={`rotate(-14 ${c} ${c})`}>
        <ellipse id="orbit" cx={c} cy={c} rx="236" ry="62" fill="none" stroke="#e9cf98" strokeOpacity="0.28" strokeWidth="0.8" />
        <circle r="3.2" fill="#f3d79b">
          <animateMotion dur="18s" repeatCount="indefinite" path={`M ${c + 236} ${c} A 236 62 0 1 1 ${c - 236} ${c} A 236 62 0 1 1 ${c + 236} ${c}`} />
        </circle>
      </g>
    </svg>
  );
}
