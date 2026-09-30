import "server-only";
import { registerWorkflow } from "@/server/workflow/registry";

export interface ProposalData {
  projectId: string;
  code: string;
  title: string;
  pi: string;
  department: string;
  agency: string;
  amount: number;
  months: number;
}

registerWorkflow({
  key: "research.proposal",
  name: "Research proposal clearance",
  module: "Research",
  description: "Institutional clearance before a proposal is sent to the funding agency: head of department, then the Dean of Research.",
  defaultSteps: [
    { key: "hod", name: "Head of department", approvers: [{ type: "role", role: "HOD", scope: "subject_department" }], mode: "ANY", slaHours: 72, allowReturn: true, allowDelegate: true },
    { key: "research", name: "Dean of Research", approvers: [{ type: "role", role: "RESEARCH_DEAN", scope: "global" }], mode: "ANY", slaHours: 96, allowReturn: true, allowDelegate: true },
  ],
  details: (raw) => {
    const d = raw as ProposalData;
    return [["Project", `${d.code} — ${d.title}`], ["Principal investigator", d.pi], ["Department", d.department], ["Funding agency", d.agency], ["Amount proposed", d.amount.toFixed(2)], ["Duration", `${d.months} months`]];
  },
  href: (i) => `/research/projects/${(i.data as unknown as ProposalData).projectId}`,
  async onApproved(tx, instance) {
    await tx.researchProject.update({ where: { id: (instance.data as unknown as ProposalData).projectId }, data: { status: "APPROVED" } });
  },
  async onRejected(tx, instance) {
    await tx.researchProject.update({ where: { id: (instance.data as unknown as ProposalData).projectId }, data: { status: "REJECTED" } });
  },
  async onReturned(tx, instance) {
    await tx.researchProject.update({ where: { id: (instance.data as unknown as ProposalData).projectId }, data: { status: "DRAFT" } });
  },
  async onCancelled(tx, instance) {
    await tx.researchProject.update({ where: { id: (instance.data as unknown as ProposalData).projectId }, data: { status: "WITHDRAWN" } });
  },
});
