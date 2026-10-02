import "server-only";
import { revokeAcademicVcs } from "@/server/services/vc";
import { z } from "zod";
import { CredentialType } from "@/generated/prisma/enums";
import { loadStudentFor } from "@/server/auth/access";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { assertRate } from "@/server/security/rate-limit";
import { audit } from "@/server/services/audit";
import { CREDENTIAL_LABEL, issueCredential, verifySeal } from "@/server/services/credential-issue";
import { startWorkflow } from "@/server/services/workflow";
import type { CredentialRequestData } from "@/server/workflow/modules/exam";

/** Documents a student may request for themselves (others are issued by the Registrar's office directly). */
export const REQUESTABLE: CredentialType[] = ["BONAFIDE_CERTIFICATE", "TRANSCRIPT", "MARKSHEET", "COURSE_COMPLETION", "MIGRATION_CERTIFICATE", "TRANSFER_CERTIFICATE"];

export async function issueForStudent(ctx: AuthContext, studentId: string, raw: unknown) {
  if (!can(ctx, "credential.issue")) throw forbidden();
  await loadStudentFor(ctx, studentId);
  const v = z.object({ type: z.enum(CredentialType), purpose: z.string().trim().max(200).nullable().optional(), termId: z.string().nullable().optional() }).parse(raw);
  const s = await db.student.findUniqueOrThrow({ where: { id: studentId } });
  if (["DEGREE_CERTIFICATE", "PROVISIONAL_CERTIFICATE"].includes(v.type) && s.status !== "GRADUATED") throw workflowError("Degree and provisional certificates are issued only to graduated students.");
  if (v.type === "COURSE_COMPLETION" && !["GRADUATED"].includes(s.status)) throw workflowError("Course completion certificates are issued after graduation.");
  if (v.type === "MARKSHEET" && !v.termId) throw invalid("Choose the term for the statement of marks.");
  return db.$transaction((tx) => issueCredential(tx, { id: ctx.user.id, name: ctx.user.name }, v.type, studentId, { purpose: v.purpose ?? null, termId: v.termId ?? null }));
}

export async function revokeCredential(ctx: AuthContext, id: string, reason: string) {
  if (!can(ctx, "credential.revoke")) throw forbidden();
  if (String(reason ?? "").trim().length < 10) throw invalid("Give the reason for revocation (at least 10 characters).");
  const c = await db.issuedCredential.findUnique({ where: { id } });
  if (!c) throw notFound("Credential");
  if (c.status === "REVOKED") throw conflict("Already revoked.");
  await db.$transaction(async (tx) => {
    await tx.issuedCredential.update({ where: { id }, data: { status: "REVOKED", revokedAt: new Date(), revokeReason: reason } });
    await revokeAcademicVcs(tx, id);
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "credential.revoke", resourceType: "student", resourceId: c.studentId, summary: `${c.serialNo} revoked — ${reason}` }, tx);
  });
}

export async function requestCredential(ctx: AuthContext, raw: unknown) {
  if (!can(ctx, "credential.request") || !ctx.subject.studentId) throw forbidden();
  const v = z.object({ type: z.enum(CredentialType), purpose: z.string().trim().min(5, "State the purpose").max(200), termId: z.string().nullable().optional() }).parse(raw);
  if (!REQUESTABLE.includes(v.type)) throw invalid("This document cannot be requested online.");
  const s = await db.student.findUniqueOrThrow({ where: { id: ctx.subject.studentId } });
  const data: CredentialRequestData = { studentId: s.id, studentNo: s.studentNo, studentName: `${s.firstName} ${s.lastName}`, type: v.type, purpose: v.purpose, termId: v.termId ?? null };
  return db.$transaction((tx) =>
    startWorkflow(tx, { id: ctx.user.id, name: ctx.user.name }, {
      key: "credential.request", resourceType: "credentialRequest", resourceId: `${s.id}:${v.type}:${Date.now()}`, title: `${CREDENTIAL_LABEL[v.type]} for ${data.studentName}`,
      summary: v.purpose, departmentId: s.departmentId, subjectUserId: s.userId, data: data as unknown as Record<string, unknown>,
    }),
  );
}

/** A credential the caller may view: the student, their guardian, or staff who can see the student. */
export async function loadCredentialFor(ctx: AuthContext, id: string) {
  const c = await db.issuedCredential.findUnique({ where: { id } });
  if (!c) throw notFound("Credential");
  await loadStudentFor(ctx, c.studentId).catch(() => {
    throw notFound("Credential");
  });
  return c;
}

/**
 * Public verification (no sign-in). Returns only what a verifier needs, and re-checks the seal so an
 * altered database row shows as invalid. Rate-limited per client to prevent code enumeration.
 */
export async function verifyCredential(code: string, clientKey: string) {
  assertRate(`verify:${clientKey}`, 30, 60_000);
  const normalized = String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(.{4})(?=.)/g, "$1-");
  if (normalized.length < 10) return null;
  const c = await db.issuedCredential.findUnique({ where: { verificationCode: normalized } });
  if (!c) return null;
  const intact = verifySeal(c.payload, c.contentHash, c.seal);
  const p = c.payload as { student?: { name?: string; studentNo?: string }; programme?: { name?: string }; institution?: { name?: string }; issuedOn?: string; cgpa?: number | null };
  return {
    intact,
    status: c.status,
    type: c.type,
    title: c.title,
    serialNo: c.serialNo,
    issuedAt: c.issuedAt,
    revokedAt: c.revokedAt,
    revokeReason: c.status === "REVOKED" ? c.revokeReason : null,
    studentName: p.student?.name ?? "",
    studentNo: p.student?.studentNo ?? "",
    programme: p.programme?.name ?? "",
    institution: p.institution?.name ?? "",
    cgpa: p.cgpa ?? null,
    contentHash: c.contentHash,
  };
}
