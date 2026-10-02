import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";
import { SupportPanel } from "@/features/success/support-panel";
import { requirePageAuth } from "@/server/auth/current";

export const metadata: Metadata = { title: "Mentoring & support" };

export default async function MySupportPage() {
  const ctx = await requirePageAuth("self.portal");
  if (!ctx.subject.studentId) redirect("/portal");
  return (
    <div className="space-y-6">
      <PageHeader title="Mentoring & support" breadcrumbs={[{ label: "My studies" }, { label: "Mentoring & support" }]} description="Your mentor, what you agreed in your meetings, and help when you need it." />
      <SupportPanel ctx={ctx} studentId={ctx.subject.studentId} self />
    </div>
  );
}
