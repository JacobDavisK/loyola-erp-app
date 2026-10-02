import localFont from "next/font/local";

/** Computer Modern Unicode — the typefaces of LaTeX (Knuth), self-hosted under the SIL Open Font Licence (fonts/cmu/OFL.txt). */
export const cmuSerif = localFont({
  variable: "--font-cmu",
  display: "swap",
  src: [
    { path: "../fonts/cmu/cmu-serif-500-roman.woff2", weight: "400", style: "normal" },
    { path: "../fonts/cmu/cmu-serif-500-italic.woff2", weight: "400", style: "italic" },
    { path: "../fonts/cmu/cmu-serif-700-roman.woff2", weight: "700", style: "normal" },
  ],
  fallback: ["Latin Modern Roman", "Georgia", "serif"],
});

export const cmuMono = localFont({
  variable: "--font-cmu-mono",
  display: "swap",
  preload: false,
  src: [{ path: "../fonts/cmu/cmu-typewriter-text-500-roman.woff2", weight: "400", style: "normal" }],
  fallback: ["ui-monospace", "monospace"],
});
