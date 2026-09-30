import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";
import { WithdrawButton } from "@/features/workflow/decision-panel";
import { RequestView } from "@/features/workflow/request-view";
import { can, requirePageAuth } from "@/server/auth/current";
import { loadInstanceFor } from "@/server/services/workflow";

export const metadata: Metadata = { title: "Request" };

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth();
  const loaded = await loadInstanceFor(ctx, id).catch(() => null);
  if (!loaded) notFound();
  const inst = loaded.instance;
  const open = inst.status === "IN_PROGRESS" || inst.status === "RETURNED";
  const canWithdraw = open && (inst.initiatorId === ctx.user.id || can(ctx, "workflow.monitor", inst.departmentId ?? undefined));
  return (
    <div>
      <PageHeader title="Request" breadcrumbs={[{ label: "Approval centre", href: "/inbox?view=requests" }, { label: inst.title }]} />
      <RequestView loaded={loaded}>
        {inst.status === "RETURNED" && inst.initiatorId === ctx.user.id && (
          <p className="mb-3 rounded-lg border border-tone-warning/40 bg-tone-warning/5 px-3 py-2 text-sm">
            This request was returned for correction. Update the record it concerns and resubmit it from there, or withdraw it.
          </p>
        )}
        {canWithdraw ? <WithdrawButton instanceId={inst.id} /> : !open && <p className="text-sm text-muted-foreground">This request is closed.</p>}
      </RequestView>
    </div>
  );
}
