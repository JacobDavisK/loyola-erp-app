import "server-only";
import { workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { notify } from "@/server/services/notifications";
import { registerWorkflow } from "@/server/workflow/registry";

interface PurchaseData {
  requestId: string;
  number: string;
  title: string;
  department: string;
  amount: number;
  budget: string | null;
  available: number | null;
  requestedById: string;
}

registerWorkflow({
  key: "procurement.request",
  name: "Purchase request",
  module: "Operations",
  description: "A department's request to buy goods or services. Large amounts also need the Finance Officer.",
  defaultSteps: [
    { key: "hod", name: "Head of department", approvers: [{ type: "role", role: "HOD", scope: "subject_department" }], mode: "ANY", slaHours: 72, allowReturn: true, allowDelegate: true },
    { key: "finance", name: "Finance Officer (large amounts)", approvers: [{ type: "role", role: "FINANCE_OFFICER", scope: "global" }], mode: "ANY", condition: { field: "amount", op: "gte", value: 50000 }, slaHours: 72, allowReturn: true, allowDelegate: true },
  ],
  details: (raw) => {
    const d = raw as PurchaseData;
    return [
      ["Request", `${d.number}: ${d.title}`],
      ["Department", d.department],
      ["Estimated amount", d.amount.toLocaleString("en-IN", { style: "currency", currency: "INR" })],
      ["Budget", d.budget ? `${d.budget}${d.available !== null ? ` — available before this request: ${d.available.toLocaleString("en-IN", { style: "currency", currency: "INR" })}` : ""}` : "Not linked to a budget line"],
    ];
  },
  href: (i) => `/procurement/requests/${(i.data as unknown as PurchaseData).requestId}`,
  async onApproved(tx, instance) {
    const d = instance.data as unknown as PurchaseData;
    const r = await tx.purchaseRequest.findUniqueOrThrow({ where: { id: d.requestId } });
    if (r.status !== "SUBMITTED") throw workflowError("The purchase request is no longer awaiting approval.");
    await tx.purchaseRequest.update({ where: { id: r.id }, data: { status: "APPROVED" } });
    await notify({ userIds: [r.requestedById], type: "procurement.request", title: `Purchase request ${r.number} approved`, link: `/procurement/requests/${r.id}` }, tx);
    await audit({ actorId: null, actorName: "Workflow", action: "procurement.request.approved", resourceType: "purchaseRequest", resourceId: r.id, summary: r.number }, tx);
  },
  async onRejected(tx, instance) {
    await tx.purchaseRequest.update({ where: { id: (instance.data as unknown as PurchaseData).requestId }, data: { status: "REJECTED" } });
  },
  async onReturned(tx, instance) {
    await tx.purchaseRequest.update({ where: { id: (instance.data as unknown as PurchaseData).requestId }, data: { status: "DRAFT" } });
  },
  async onCancelled(tx, instance) {
    await tx.purchaseRequest.update({ where: { id: (instance.data as unknown as PurchaseData).requestId }, data: { status: "CANCELLED" } });
  },
});
