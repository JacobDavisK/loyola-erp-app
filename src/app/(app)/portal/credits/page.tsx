import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";
import { NepPanel } from "@/features/compliance/nep-panel";
import { requirePageAuth } from "@/server/auth/current";

export const metadata: Metadata = { title: "Credits & APAAR" };

/** The student's APAAR / ABC ID, credit transfers and NEP exit options. */
export default async function MyCreditsPage() {
  const ctx = await requirePageAuth("self.portal");
  if (!ctx.subject.studentId) redirect("/portal");
  return (
    <div className="space-y-6">
      <PageHeader title="Credits & APAAR" breadcrumbs={[{ label: "My studies" }, { label: "Credits & APAAR" }]} description="Your Academic Bank of Credits ID, credits from SWAYAM and other courses, and your multiple-exit options under NEP 2020." />
      <NepPanel ctx={ctx} studentId={ctx.subject.studentId} self />
    </div>
  );
}
