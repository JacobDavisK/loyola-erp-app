import "server-only";
import { workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { emitEvent } from "@/server/services/events";
import { registerWorkflow } from "@/server/workflow/registry";

export interface StudentStatusData {
  studentId: string;
  studentNo: string;
  studentName: string;
  from: string;
  to: string;
  reason: string;
  effectiveOn: string;
  programCode: string;
}

const LABEL: Record<string, string> = {
  ACTIVE: "Active", ON_LEAVE: "On leave", SUSPENDED: "Suspended", WITHDRAWN: "Withdrawn", DISCONTINUED: "Discontinued", GRADUATED: "Graduated",
};

registerWorkflow({
  key: "student.status_change",
  name: "Student status change",
  module: "Students",
  description: "Changing a student's academic status (leave, suspension, withdrawal, discontinuation, graduation, reinstatement).",
  defaultSteps: [
    { key: "hod", name: "Head of department", approvers: [{ type: "role", role: "HOD", scope: "subject_department" }], mode: "ANY", slaHours: 72, allowReturn: true, allowDelegate: true },
    { key: "registrar", name: "Registrar", approvers: [{ type: "role", role: "REGISTRAR", scope: "global" }], mode: "ANY", slaHours: 72, allowReturn: true, allowDelegate: true },
  ],
  details: (raw) => {
    const d = raw as StudentStatusData;
    return [
      ["Student", `${d.studentName} (${d.studentNo}, ${d.programCode})`],
      ["Change", `${LABEL[d.from] ?? d.from} → ${LABEL[d.to] ?? d.to}`],
      ["Effective", d.effectiveOn.slice(0, 10)],
      ["Reason", d.reason],
    ];
  },
  href: (i) => `/students/${(i.data as unknown as StudentStatusData).studentId}`,
  async onApproved(tx, instance) {
    const d = instance.data as unknown as StudentStatusData;
    const s = await tx.student.findUniqueOrThrow({ where: { id: d.studentId } });
    if (s.status !== d.from) {
      // The status moved on while the request was pending — refuse to apply a stale change.
      throw workflowError(`The student's status changed to ${LABEL[s.status]} while this request was pending. Withdraw it and raise a new one.`);
    }
    await tx.student.update({ where: { id: d.studentId }, data: { status: d.to as never, ...(d.to === "GRADUATED" ? { graduatedOn: new Date(d.effectiveOn) } : {}) } });
    await tx.studentStatusChange.create({
      data: { studentId: d.studentId, from: d.from as never, to: d.to as never, reason: d.reason, effectiveOn: new Date(d.effectiveOn), changedById: instance.initiatorId, workflowInstanceId: instance.id },
    });
    if (s.userId) {
      // Portal access follows academic status: suspended, withdrawn and discontinued students are signed out
      // and their account disabled; reinstatement re-enables it.
      if (["SUSPENDED", "WITHDRAWN", "DISCONTINUED"].includes(d.to)) {
        await tx.user.update({ where: { id: s.userId }, data: { status: "SUSPENDED" } });
        await tx.session.updateMany({ where: { userId: s.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      } else {
        await tx.user.update({ where: { id: s.userId }, data: { status: "ACTIVE" } });
      }
    }
    await audit({ actorId: null, actorName: "Workflow", action: "student.status", resourceType: "student", resourceId: d.studentId, summary: `${d.studentNo}: ${LABEL[d.from]} → ${LABEL[d.to]}`, oldValue: { status: d.from }, newValue: { status: d.to, reason: d.reason, effectiveOn: d.effectiveOn } }, tx);
    await emitEvent(tx, { type: d.to === "GRADUATED" ? "StudentGraduated" : "StudentStatusChanged", aggregateType: "student", aggregateId: d.studentId, payload: { from: d.from, to: d.to } });
  },
});
