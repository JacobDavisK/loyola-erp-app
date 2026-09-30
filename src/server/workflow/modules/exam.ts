import "server-only";
import type { CredentialType } from "@/generated/prisma/enums";
import { audit } from "@/server/services/audit";
import { CREDENTIAL_LABEL, issueCredential } from "@/server/services/credential-issue";
import { notify } from "@/server/services/notifications";
import { publishRunInTx } from "@/server/services/result-engine";
import { registerWorkflow } from "@/server/workflow/registry";

// ───────── Attendance condonation for examination eligibility ─────────

export interface CondonationData {
  registrationId: string;
  studentId: string;
  studentNo: string;
  studentName: string;
  course: string;
  attendancePct: number;
  reason: string;
}

registerWorkflow({
  key: "exam.condonation",
  name: "Attendance condonation",
  module: "Examinations",
  description: "A student in the condonation band asks to sit an examination despite attendance below the minimum.",
  defaultSteps: [
    { key: "hod", name: "Head of department", approvers: [{ type: "role", role: "HOD", scope: "subject_department" }], mode: "ANY", slaHours: 48, allowReturn: true, allowDelegate: true },
    { key: "coe", name: "Controller of Examinations", approvers: [{ type: "role", role: "EXAM_CONTROLLER", scope: "global" }], mode: "ANY", slaHours: 48, allowReturn: true, allowDelegate: true },
  ],
  details: (raw) => {
    const d = raw as CondonationData;
    return [["Student", `${d.studentName} (${d.studentNo})`], ["Course", d.course], ["Attendance", `${d.attendancePct}%`], ["Reason", d.reason]];
  },
  async onApproved(tx, instance) {
    const d = instance.data as unknown as CondonationData;
    await tx.examRegistration.update({ where: { id: d.registrationId }, data: { status: "ELIGIBLE", reasons: [] } });
    await audit({ actorId: null, actorName: "Workflow", action: "exam.condonation.approved", resourceType: "student", resourceId: d.studentId, summary: `${d.course}: condoned at ${d.attendancePct}%` }, tx);
  },
  async onRejected(tx, instance) {
    const d = instance.data as unknown as CondonationData;
    await tx.examRegistration.update({ where: { id: d.registrationId }, data: { status: "NOT_ELIGIBLE", reasons: [`Attendance ${d.attendancePct}% — condonation refused`] } });
  },
});

// ───────── Mark sheet verification & approval ─────────

export interface MarkSheetData {
  sheetId: string;
  offeringId: string;
  component: string;
  kind: string;
  course: string;
  section: string;
  students: number;
  entered: number;
  absent: number;
  average: number | null;
}

registerWorkflow({
  key: "marks.sheet",
  name: "Mark sheet approval",
  module: "Marks & results",
  description: "Marks entered by the instructor are verified by the Head of Department; external components also need the Controller's approval.",
  defaultSteps: [
    { key: "verify", name: "Department verification", approvers: [{ type: "role", role: "HOD", scope: "subject_department" }], mode: "ANY", slaHours: 72, allowReturn: true, allowDelegate: true },
    { key: "coe", name: "Controller approval", approvers: [{ type: "role", role: "EXAM_CONTROLLER", scope: "global" }], mode: "ANY", condition: { field: "kind", op: "in", value: ["EXTERNAL"] }, slaHours: 72, allowReturn: true, allowDelegate: true },
  ],
  details: (raw) => {
    const d = raw as MarkSheetData;
    return [["Class", `${d.course}-${d.section}`], ["Component", `${d.component} (${d.kind.toLowerCase()})`], ["Marks entered", `${d.entered} of ${d.students}${d.absent ? `, ${d.absent} absent` : ""}`], ["Class average", d.average === null ? "—" : String(d.average)]];
  },
  href: (i) => `/academics/offerings/${(i.data as unknown as MarkSheetData).offeringId}?tab=marks`,
  async onApproved(tx, instance) {
    const d = instance.data as unknown as MarkSheetData;
    await tx.markSheet.update({ where: { id: d.sheetId }, data: { status: "APPROVED", approvedAt: new Date() } });
  },
  async onReturned(tx, instance) {
    const d = instance.data as unknown as MarkSheetData;
    await tx.markSheet.update({ where: { id: d.sheetId }, data: { status: "RETURNED" } });
  },
  async onRejected(tx, instance) {
    const d = instance.data as unknown as MarkSheetData;
    await tx.markSheet.update({ where: { id: d.sheetId }, data: { status: "RETURNED" } });
  },
  async onCancelled(tx, instance) {
    const d = instance.data as unknown as MarkSheetData;
    await tx.markSheet.update({ where: { id: d.sheetId }, data: { status: "DRAFT" } });
  },
});

// ───────── Result publication ─────────

export interface ResultRunData {
  runId: string;
  session: string;
  program: string;
  students: number;
  courses: number;
  passPercent: number;
  warnings: number;
}

registerWorkflow({
  key: "result.publication",
  name: "Result publication",
  module: "Marks & results",
  description: "Computed results are verified by the department, reviewed by the Controller and approved by the Registrar before publication.",
  defaultSteps: [
    { key: "department", name: "Department verification", approvers: [{ type: "role", role: "HOD", scope: "subject_department" }], mode: "ANY", slaHours: 48, allowReturn: true, allowDelegate: true },
    { key: "controller", name: "Controller review", approvers: [{ type: "role", role: "EXAM_CONTROLLER", scope: "global" }], mode: "ANY", slaHours: 48, allowReturn: true, allowDelegate: false },
    { key: "registrar", name: "Registrar approval", approvers: [{ type: "role", role: "REGISTRAR", scope: "global" }], mode: "ANY", slaHours: 48, allowReturn: true, allowDelegate: false },
  ],
  details: (raw) => {
    const d = raw as ResultRunData;
    return [["Session", d.session], ["Programme", d.program], ["Students", String(d.students)], ["Course results", String(d.courses)], ["Pass rate", `${d.passPercent}%`], ["Warnings at computation", String(d.warnings)]];
  },
  href: (i) => `/results/${(i.data as unknown as ResultRunData).runId}`,
  async onApproved(tx, instance) {
    const d = instance.data as unknown as ResultRunData;
    await tx.resultRun.update({ where: { id: d.runId }, data: { status: "APPROVED" } });
    await publishRunInTx(tx, d.runId);
  },
  async onReturned(tx, instance) {
    await tx.resultRun.update({ where: { id: (instance.data as unknown as ResultRunData).runId }, data: { status: "COMPUTED" } });
  },
  async onRejected(tx, instance) {
    await tx.resultRun.update({ where: { id: (instance.data as unknown as ResultRunData).runId }, data: { status: "COMPUTED" } });
  },
  async onCancelled(tx, instance) {
    await tx.resultRun.update({ where: { id: (instance.data as unknown as ResultRunData).runId }, data: { status: "COMPUTED" } });
  },
});

// ───────── Certificate requests ─────────

export interface CredentialRequestData {
  studentId: string;
  studentNo: string;
  studentName: string;
  type: CredentialType;
  purpose: string;
  termId: string | null;
}

registerWorkflow({
  key: "credential.request",
  name: "Certificate request",
  module: "Credentials",
  description: "A student requests a certificate or transcript. The Registrar's office approves and it is issued automatically with a verification code.",
  defaultSteps: [
    { key: "registrar", name: "Registrar's office", approvers: [{ type: "role", role: "REGISTRAR", scope: "global" }], mode: "ANY", slaHours: 72, allowReturn: true, allowDelegate: true },
  ],
  details: (raw) => {
    const d = raw as CredentialRequestData;
    return [["Student", `${d.studentName} (${d.studentNo})`], ["Document", CREDENTIAL_LABEL[d.type]], ["Purpose", d.purpose]];
  },
  href: (i) => `/students/${(i.data as unknown as CredentialRequestData).studentId}?tab=credentials`,
  async onApproved(tx, instance) {
    const d = instance.data as unknown as CredentialRequestData;
    const cred = await issueCredential(tx, { id: null, name: "Workflow" }, d.type, d.studentId, { purpose: d.purpose, termId: d.termId });
    await notify({ userIds: [instance.initiatorId], type: "credential.issued", title: `${CREDENTIAL_LABEL[d.type]} issued`, body: `Serial ${cred.serialNo}`, link: `/credentials/${cred.id}` }, tx);
  },
});
