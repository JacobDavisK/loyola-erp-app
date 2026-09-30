import "server-only";
import { audit } from "@/server/services/audit";
import { applyConcession } from "@/server/services/finance-core";
import { notify } from "@/server/services/notifications";
import { registerWorkflow } from "@/server/workflow/registry";

export interface ConcessionData {
  concessionId: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  invoiceNo: string;
  amount: number; // currency units, for conditions
  kind: string;
  reason: string;
}

registerWorkflow({
  key: "finance.concession",
  name: "Fee concession / waiver",
  module: "Finance",
  description: "A concession or waiver on a student's invoice. Large amounts also need the Registrar.",
  defaultSteps: [
    { key: "finance", name: "Finance Officer", approvers: [{ type: "role", role: "FINANCE_OFFICER", scope: "global" }], mode: "ANY", slaHours: 72, allowReturn: true, allowDelegate: true },
    { key: "registrar", name: "Registrar (large amounts)", approvers: [{ type: "role", role: "REGISTRAR", scope: "global" }], mode: "ANY", condition: { field: "amount", op: "gte", value: 50000 }, slaHours: 72, allowReturn: true, allowDelegate: false },
  ],
  details: (raw) => {
    const d = raw as ConcessionData;
    return [["Student", `${d.studentName} (${d.studentNo})`], ["Invoice", d.invoiceNo], ["Type", d.kind.toLowerCase()], ["Amount", d.amount.toFixed(2)], ["Reason", d.reason]];
  },
  href: (i) => `/students/${(i.data as unknown as ConcessionData).studentId}?tab=fees`,
  async onApproved(tx, instance) {
    const d = instance.data as unknown as ConcessionData;
    await applyConcession(tx, d.concessionId, { id: null, name: "Workflow" });
  },
  async onRejected(tx, instance) {
    const d = instance.data as unknown as ConcessionData;
    await tx.concession.update({ where: { id: d.concessionId }, data: { status: "REJECTED", decidedAt: new Date() } });
  },
  async onCancelled(tx, instance) {
    const d = instance.data as unknown as ConcessionData;
    await tx.concession.update({ where: { id: d.concessionId }, data: { status: "CANCELLED", decidedAt: new Date() } });
  },
});

export interface RefundData {
  refundId: string;
  paymentId: string;
  receiptNo: string;
  studentId: string;
  studentName: string;
  amount: number;
  reason: string;
}

registerWorkflow({
  key: "finance.refund",
  name: "Fee refund",
  module: "Finance",
  description: "Refund of a received payment (e.g. withdrawal, excess payment). Paid out by Accounts after approval.",
  defaultSteps: [
    { key: "finance", name: "Finance Officer", approvers: [{ type: "role", role: "FINANCE_OFFICER", scope: "global" }], mode: "ANY", slaHours: 72, allowReturn: true, allowDelegate: true },
    { key: "registrar", name: "Registrar", approvers: [{ type: "role", role: "REGISTRAR", scope: "global" }], mode: "ANY", slaHours: 72, allowReturn: true, allowDelegate: false },
  ],
  details: (raw) => {
    const d = raw as RefundData;
    return [["Student", d.studentName], ["Receipt", d.receiptNo], ["Amount", d.amount.toFixed(2)], ["Reason", d.reason]];
  },
  href: (i) => `/finance/payments/${(i.data as unknown as RefundData).paymentId}`,
  async onApproved(tx, instance) {
    const d = instance.data as unknown as RefundData;
    await tx.refund.update({ where: { id: d.refundId }, data: { status: "APPROVED" } });
  },
  async onRejected(tx, instance) {
    const d = instance.data as unknown as RefundData;
    await tx.refund.update({ where: { id: d.refundId }, data: { status: "REJECTED" } });
  },
  async onCancelled(tx, instance) {
    const d = instance.data as unknown as RefundData;
    await tx.refund.update({ where: { id: d.refundId }, data: { status: "REJECTED" } });
  },
});

export interface ScholarshipData {
  applicationId: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  scheme: string;
  eligible: boolean;
  proposedAward: number;
  statement: string;
}

registerWorkflow({
  key: "scholarship.application",
  name: "Scholarship application",
  module: "Finance",
  description: "A student applies for a scholarship; the department recommends and the scholarship desk decides.",
  defaultSteps: [
    { key: "hod", name: "Department recommendation", approvers: [{ type: "role", role: "HOD", scope: "subject_department" }], mode: "ANY", slaHours: 120, allowReturn: true, allowDelegate: true },
    { key: "desk", name: "Scholarship desk", approvers: [{ type: "role", role: "FINANCE_OFFICER", scope: "global" }], mode: "ANY", slaHours: 120, allowReturn: true, allowDelegate: true },
  ],
  details: (raw) => {
    const d = raw as ScholarshipData;
    return [["Student", `${d.studentName} (${d.studentNo})`], ["Scheme", d.scheme], ["Rule check", d.eligible ? "All criteria met" : "Some criteria not met — see application"], ["Proposed award", d.proposedAward.toFixed(2)], ["Statement", d.statement]];
  },
  href: (i) => `/finance/scholarships?application=${(i.data as unknown as ScholarshipData).applicationId}`,
  async onApproved(tx, instance) {
    const d = instance.data as unknown as ScholarshipData;
    await tx.scholarshipApplication.update({ where: { id: d.applicationId }, data: { status: "APPROVED", decidedAt: new Date(), awardAmount: d.proposedAward.toFixed(2) } });
    await audit({ actorId: null, actorName: "Workflow", action: "scholarship.approve", resourceType: "student", resourceId: d.studentId, summary: `${d.scheme}: ${d.proposedAward.toFixed(2)} awarded` }, tx);
    const s = await tx.student.findUnique({ where: { id: d.studentId }, select: { userId: true } });
    await notify({ userIds: [s?.userId], type: "scholarship.approved", title: `Scholarship awarded: ${d.scheme}`, body: "The award will be credited against your fees.", link: "/portal/fees" }, tx);
  },
  async onRejected(tx, instance) {
    const d = instance.data as unknown as ScholarshipData;
    await tx.scholarshipApplication.update({ where: { id: d.applicationId }, data: { status: "REJECTED", decidedAt: new Date() } });
  },
  async onReturned(tx, instance) {
    const d = instance.data as unknown as ScholarshipData;
    await tx.scholarshipApplication.update({ where: { id: d.applicationId }, data: { status: "UNDER_REVIEW" } });
  },
  async onCancelled(tx, instance) {
    const d = instance.data as unknown as ScholarshipData;
    await tx.scholarshipApplication.update({ where: { id: d.applicationId }, data: { status: "WITHDRAWN", decidedAt: new Date() } });
  },
});
