import "server-only";
import { cache } from "react";
import { type Branding, DEFAULT_BRANDING, safeColor, splitTagline } from "@/lib/branding";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { signedAssetUrl } from "@/server/storage";

/**
 * The branding for this installation: environment variables first, then the institution profile
 * (name, short name, logo, e-mail from the Configuration centre), then the defaults.
 */
export const getBranding = cache(async (): Promise<Branding> => {
  const inst = await db.institution.findFirst({ select: { name: true, shortName: true, email: true, logoAssetId: true } }).catch(() => null);
  const d = DEFAULT_BRANDING;
  return {
    universityName: env.UNIVERSITY_NAME?.trim() || inst?.name || d.universityName,
    shortName: inst?.shortName || d.shortName,
    logoUrl: env.UNIVERSITY_LOGO?.trim() || (inst?.logoAssetId ? signedAssetUrl(inst.logoAssetId, 3600) : null),
    primaryColor: safeColor(env.PRIMARY_COLOR, d.primaryColor),
    secondaryColor: safeColor(env.SECONDARY_COLOR, d.secondaryColor),
    tagline: splitTagline(env.TAGLINE, d.tagline),
    campusName: env.CAMPUS_NAME?.trim() || d.campusName,
    platformName: d.platformName,
    supportContact: env.SUPPORT_EMAIL?.trim() || inst?.email || d.supportContact,
  };
});
