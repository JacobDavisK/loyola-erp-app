import { Lock } from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { type Branding, supportHref } from "@/lib/branding";
import { type Locale, translate } from "@/lib/i18n";
import { BrandLogo } from "./brand-logo";
import { EcosystemGraph } from "./ecosystem-graph";

/**
 * The frame every sign-in screen shares: institutional identity on the left (45%), the task on the right
 * (55%). On phones and small tablets the identity collapses to a centred logo and name above the form.
 */
export function AuthShell({ branding, locale, children }: { branding: Branding; locale: Locale; children: React.ReactNode }) {
  const t = (s: string) => translate(locale, s);
  const style = { "--brand": branding.primaryColor, "--brand-2": branding.secondaryColor } as React.CSSProperties;
  return (
    <div className="auth-root min-h-dvh lg:grid lg:grid-cols-[45fr_55fr]" style={style}>
      {/* Identity */}
      <aside className="relative hidden overflow-hidden border-r border-[var(--line)] bg-[var(--panel)] lg:flex lg:flex-col">
        <div aria-hidden className="auth-grid absolute inset-0" />
        <div aria-hidden className="auth-accent-wash absolute inset-0" />
        <div className="relative flex min-h-dvh flex-col px-12 py-10 xl:px-16 2xl:px-24">
          <div className="auth-enter flex items-center gap-3">
            <BrandLogo branding={branding} />
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-tight">{branding.universityName}</div>
              {branding.campusName && <div className="text-[13px] text-[var(--text-3)]">{branding.campusName}</div>}
            </div>
          </div>
          <div className="auth-enter auth-enter-2 mt-[clamp(48px,9vh,112px)] max-w-[30rem] 2xl:max-w-[44rem]">
            <p className="text-[clamp(30px,2.6vw,44px)] leading-[1.1] font-semibold tracking-[-0.025em] text-balance">
              {branding.tagline[0]}
              {branding.tagline[1] && <span className="block text-[var(--text-3)]">{branding.tagline[1]}</span>}
            </p>
          </div>
          <div className="auth-enter auth-enter-3 flex flex-1 items-center py-8">
            <EcosystemGraph core={branding.platformName} className="mx-auto w-full max-w-[620px] 2xl:max-w-[860px]" />
          </div>
          <div className="flex items-center gap-2 text-[13px] text-[var(--text-3)]">
            <Lock className="size-3.5" aria-hidden /> {t("Secure institutional sign-in")}
          </div>
        </div>
      </aside>

      {/* Task */}
      <main className="relative flex min-h-dvh flex-col px-5 pt-6 pb-8 sm:px-10 lg:px-12">
        <div className="flex justify-end">
          <LanguageSwitcher current={locale} label={t("Language")} className="min-h-11" />
        </div>
        <div className="mx-auto flex w-full max-w-[400px] flex-1 2xl:max-w-[460px] flex-col justify-center py-8">
          <div className="auth-enter mb-10 flex flex-col items-center gap-3 text-center lg:hidden">
            <BrandLogo branding={branding} className="size-11 text-[15px]" />
            <div className="text-[15px] font-semibold tracking-tight">{branding.universityName}</div>
          </div>
          <div className="auth-enter auth-enter-2">{children}</div>
        </div>
        <footer className="mx-auto w-full max-w-[400px] 2xl:max-w-[460px] space-y-3 text-center text-[13px] text-[var(--text-3)]">
          <p>
            {t("Having trouble signing in?")}{" "}
            <a className="auth-link auth-link-accent inline-flex min-h-11 items-center px-1" href={supportHref(branding.supportContact)}>{t("Contact IT Support")}</a>
          </p>
          <p className="flex items-center justify-center gap-1.5 lg:hidden"><Lock className="size-3" aria-hidden /> {t("Secure institutional sign-in")}</p>
        </footer>
      </main>
    </div>
  );
}
