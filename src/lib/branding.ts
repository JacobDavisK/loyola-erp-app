/**
 * Institution branding for the sign-in experience. Nothing in the authentication components is hard-coded:
 * each value comes from here, overridden per installation by environment variables (UNIVERSITY_NAME,
 * UNIVERSITY_LOGO, PRIMARY_COLOR, SECONDARY_COLOR, TAGLINE, CAMPUS_NAME, SUPPORT_EMAIL) or by the
 * institution profile in the Configuration centre. See src/server/branding.ts for how they are resolved.
 */

export interface Branding {
  /** UNIVERSITY_NAME */
  universityName: string;
  /** Short form used in the logo mark when there is no logo image, e.g. "UW" */
  shortName: string;
  /** UNIVERSITY_LOGO: an image URL; null shows a monogram */
  logoUrl: string | null;
  /** PRIMARY_COLOR: the institutional accent (buttons, focus) */
  primaryColor: string;
  /** SECONDARY_COLOR: the second accent in the ecosystem visual */
  secondaryColor: string;
  /** TAGLINE: two short lines shown under the name */
  tagline: [string, string];
  /** CAMPUS_NAME: shown beside the name when set */
  campusName: string | null;
  /** The product's own name in the heading, e.g. "University OS" */
  platformName: string;
  /** Where "Contact IT Support" goes: an e-mail address or a URL */
  supportContact: string;
}

export const DEFAULT_BRANDING: Branding = {
  universityName: "University of the World",
  shortName: "UW",
  logoUrl: null,
  primaryColor: "#3b5bdb",
  secondaryColor: "#0ea5a4",
  tagline: ["One Digital Platform.", "Every Academic Journey."],
  campusName: null,
  platformName: "University OS",
  supportContact: "it-support@example.edu",
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
export const safeColor = (c: string | null | undefined, fallback: string) => (c && HEX.test(c.trim()) ? c.trim() : fallback);

/** "One Digital Platform. Every Academic Journey." → the two lines. */
export function splitTagline(t: string | null | undefined, fallback: [string, string]): [string, string] {
  if (!t?.trim()) return fallback;
  const parts = t.split(/(?<=\.)\s+|\s*\|\s*/).map((s) => s.trim()).filter(Boolean);
  return parts.length >= 2 ? [parts[0], parts.slice(1).join(" ")] : [parts[0], ""];
}

export function supportHref(contact: string) {
  return /^https?:\/\//.test(contact) ? contact : `mailto:${contact}?subject=${encodeURIComponent("Sign-in help")}`;
}
