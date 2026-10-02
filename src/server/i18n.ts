import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { type Locale, LOCALE_COOKIE, isLocale, translate } from "@/lib/i18n";
import { getAuth } from "@/server/auth/current";

/** The signed-in person's language, or the sign-in page's choice (cookie), or English. */
export const getLocale = cache(async (): Promise<Locale> => {
  const ctx = await getAuth();
  if (ctx) return ctx.user.locale;
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(c) ? c : "en";
});

/** A translator for server components: `const t = await getT(); t("Attendance")`. */
export async function getT() {
  const locale = await getLocale();
  return (text: string) => translate(locale, text);
}
