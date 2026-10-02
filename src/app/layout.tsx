import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Sans_Devanagari, Noto_Sans_Tamil } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";
import { BRAND } from "@/lib/brand";
import { getLocale } from "@/server/i18n";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Tamil and Hindi script fallbacks; the browser downloads them only when such text is on the page.
const tamil = Noto_Sans_Tamil({ variable: "--font-tamil", subsets: ["tamil"], preload: false });
const devanagari = Noto_Sans_Devanagari({ variable: "--font-devanagari", subsets: ["devanagari"], preload: false });

export const metadata: Metadata = {
  title: { default: BRAND.name, template: `%s · ${BRAND.name}` },
  description: BRAND.description,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#16171c" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={await getLocale()} suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} ${tamil.variable} ${devanagari.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
