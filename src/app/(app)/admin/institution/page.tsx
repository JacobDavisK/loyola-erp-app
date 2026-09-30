import type { Metadata } from "next";
import { InstitutionForm } from "@/features/admin/institution-form";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { signedAssetUrl } from "@/server/storage";

export const metadata: Metadata = { title: "Institution & branding" };

export default async function InstitutionPage() {
  await requirePageAuth("admin.institution.manage");
  const i = await db.institution.findFirstOrThrow();
  return (
    <InstitutionForm
      logoUrl={i.logoAssetId ? signedAssetUrl(i.logoAssetId) : null}
      initial={{ name: i.name, shortName: i.shortName, tagline: i.tagline ?? "", address: i.address ?? "", phone: i.phone ?? "", email: i.email ?? "", website: i.website ?? "" }}
    />
  );
}
