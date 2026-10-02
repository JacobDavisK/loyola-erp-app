import "server-only";
import { workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { issueCredential } from "@/server/services/credential-issue";
import { emitEvent } from "@/server/services/events";
import { registerWorkflow } from "@/server/workflow/registry";

interface ExitData {
  requestId: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  programCode: string;
  award: string;
  level: number;
  credits: number;
  reason: string;
}

registerWorkflow({
  key: "student.exit",
  name: "Exit with an award (NEP multiple exit)",
  module: "Students",
  description: "A student leaves the programme with an intermediate award (certificate, diploma…). On approval the status becomes Exited and a sealed exit certificate is issued.",
  defaultSteps: [
    { key: "hod", name: "Head of department", approvers: [{ type: "role", role: "HOD", scope: "subject_department" }], mode: "ANY", slaHours: 72, allowReturn: true, allowDelegate: true },
    { key: "registrar", name: "Registrar", approvers: [{ type: "role", role: "REGISTRAR", scope: "global" }], mode: "ANY", slaHours: 72, allowReturn: true, allowDelegate: true },
  ],
  details: (raw) => {
    const d = raw as ExitData;
    return [
      ["Student", `${d.studentName} (${d.studentNo}, ${d.programCode})`],
      ["Award", `${d.award} (level ${d.level})`],
      ["Credits earned", String(d.credits)],
      ["Reason", d.reason],
    ];
  },
  href: (i) => `/students/${(i.data as unknown as ExitData).studentId}?tab=nep`,
  async onApproved(tx, instance) {
    const d = instance.data as unknown as ExitData;
    const req = await tx.exitRequest.findUniqueOrThrow({ where: { id: d.requestId }, include: { award: true } });
    const s = await tx.student.findUniqueOrThrow({ where: { id: d.studentId } });
    if (!["ACTIVE", "ON_LEAVE"].includes(s.status)) throw workflowError(`The student's status changed to ${s.status.toLowerCase()} while the request was pending.`);
    const now = new Date();
    await tx.student.update({ where: { id: s.id }, data: { status: "EXITED" } });
    await tx.studentStatusChange.create({ data: { studentId: s.id, from: s.status, to: "EXITED", reason: `Exit with ${req.award.title}: ${req.reason}`, effectiveOn: now, changedById: instance.initiatorId, workflowInstanceId: instance.id } });
    const cred = await issueCredential(tx, { id: null, name: "Workflow" }, "EXIT_CERTIFICATE", s.id, { award: { title: req.award.title, level: req.award.level, credits: req.creditsEarned } });
    const reentryUntil = new Date(Date.UTC(now.getUTCFullYear() + req.award.reentryYears, now.getUTCMonth(), now.getUTCDate()));
    await tx.exitRequest.update({ where: { id: req.id }, data: { status: "APPROVED", decidedAt: now, credentialId: cred.id, reentryUntil } });
    await audit({ actorId: null, actorName: "Workflow", action: "nep.exit.approved", resourceType: "student", resourceId: s.id, summary: `${s.studentNo}: exited with ${req.award.title}; re-entry until ${reentryUntil.toISOString().slice(0, 10)}` }, tx);
    await emitEvent(tx, { type: "StudentStatusChanged", aggregateType: "student", aggregateId: s.id, payload: { from: s.status, to: "EXITED", award: req.award.title } });
  },
  async onRejected(tx, instance) {
    await tx.exitRequest.update({ where: { id: (instance.data as unknown as ExitData).requestId }, data: { status: "REJECTED", decidedAt: new Date() } });
  },
  async onCancelled(tx, instance) {
    await tx.exitRequest.update({ where: { id: (instance.data as unknown as ExitData).requestId }, data: { status: "WITHDRAWN", decidedAt: new Date() } });
  },
});
