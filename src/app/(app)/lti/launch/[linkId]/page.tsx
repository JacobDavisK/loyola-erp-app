import { Plug } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState, PageHeader, Section } from "@/components/app/page";
import { LtiAutoPost } from "@/features/teaching/controls";
import { requirePageAuth } from "@/server/auth/current";
import { startLaunch } from "@/server/services/lti";

export const metadata: Metadata = { title: "Opening tool" };

export default async function LtiLaunchPage({ params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await params;
  const ctx = await requirePageAuth();
  const launch = await startLaunch(ctx, linkId).catch(() => null);
  if (!launch) return <EmptyState icon={Plug} title="Tool unavailable" description="The tool was removed or switched off, or you are not part of this class." />;
  return (
    <div className="mx-auto max-w-md space-y-6">
      <PageHeader title="Opening the tool" />
      <Section><LtiAutoPost action={launch.action} params={launch.params} /></Section>
    </div>
  );
}
