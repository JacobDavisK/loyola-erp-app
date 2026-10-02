import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/app/page";
import { AssistantChat } from "@/features/success/controls";
import { aiStatus } from "@/server/ai/gateway";
import { requirePageAuth } from "@/server/auth/current";
import { suggestedQuestions } from "@/server/services/assistant";
import { hasConsent } from "@/server/services/privacy";
import { getSetting } from "@/server/services/settings";

export const metadata: Metadata = { title: "Assistant" };

export default async function AssistantPage() {
  const ctx = await requirePageAuth("self.portal");
  if (!ctx.subject.studentId) redirect("/portal");
  const [ai, consent, helpdesk] = await Promise.all([aiStatus(), hasConsent(ctx.user.id, "ai.assistant"), getSetting("helpdesk")]);
  const aiReady = ai.configured && ai.enabled && ai.features.studentAssistant;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Student assistant"
        breadcrumbs={[{ label: "My studies" }, { label: "Assistant" }]}
        description={
          <>
            Answers from the institution&apos;s knowledge base{consent ? " and your own records" : ""}. It never acts for you — it can draft a helpdesk ticket for you to send.{" "}
            {consent ? <>You allowed it to read your records; <Link className="text-primary hover:underline" href="/me/privacy">change this</Link>.</> : <>To let it answer about your attendance, fees and results, <Link className="text-primary hover:underline" href="/me/privacy">allow it under Privacy &amp; consent</Link>.</>}
          </>
        }
      />
      <Section>
        <AssistantChat suggestions={suggestedQuestions} aiReady={aiReady} recordsAllowed={consent} categories={helpdesk.categories.map((c) => c.key)} />
      </Section>
    </div>
  );
}
