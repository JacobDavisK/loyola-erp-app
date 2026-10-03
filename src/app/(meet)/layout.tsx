import { connection } from "next/server";
import { I18nProvider } from "@/components/i18n";
import { dictionary } from "@/lib/i18n";
import { getLocale } from "@/server/i18n";

/** The meeting room runs full screen, outside the ERP shell, in the person's language. */
export default async function MeetLayout({ children }: { children: React.ReactNode }) {
  await connection();
  return <I18nProvider dict={dictionary(await getLocale())}>{children}</I18nProvider>;
}
