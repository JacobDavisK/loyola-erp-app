import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import type { CredentialType, Prisma } from "@/generated/prisma/client";
import { canonicalJson, sha256 } from "@/lib/hash";
import type { Tx } from "@/server/db";
import { env } from "@/server/env";
import { invalid } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { emitEvent } from "@/server/services/events";
import { nextNumber } from "@/server/services/sequence";

/**
 * Issuing credentials (transcripts, marksheets, certificates). Kept free of workflow imports so the
 * certificate-request workflow can call it from its approval hook.
 *
 * Tamper evidence: the payload is frozen as canonical JSON; `contentHash` is its SHA-256 and `seal` an
 * HMAC-SHA256 with a key derived from APP_SECRET. The public verification page recomputes both.
 * This proves the record came from this system unaltered; it is not a PKI digital signature. A PAdES/
 * PKCS#7 signer can be added behind `sealPayload` when the institution has a signing certificate.
 */

const sealKey = () => createHmac("sha256", env.APP_SECRET).update("credential-seal:v1").digest();

export function sealPayload(payload: unknown) {
  const canonical = canonicalJson(payload);
  return { contentHash: sha256(canonical), seal: createHmac("sha256", sealKey()).update(canonical).digest("hex") };
}

export function verifySeal(payload: unknown, contentHash: string, seal: string) {
  const s = sealPayload(payload);
  return s.contentHash === contentHash && s.seal === seal;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I confusion
export function verificationCode() {
  const bytes = randomBytes(12);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("").replace(/(.{4})(?=.)/g, "$1-");
}

const SERIAL_PREFIX: Record<CredentialType, string> = {
  TRANSCRIPT: "TR/{YYYY}/",
  MARKSHEET: "MS/{YYYY}/",
  PROVISIONAL_CERTIFICATE: "PC/{YYYY}/",
  DEGREE_CERTIFICATE: "DC/{YYYY}/",
  MIGRATION_CERTIFICATE: "MC/{YYYY}/",
  BONAFIDE_CERTIFICATE: "BC/{YYYY}/",
  COURSE_COMPLETION: "CC/{YYYY}/",
  RANK_CERTIFICATE: "RC/{YYYY}/",
  TRANSFER_CERTIFICATE: "TC/{YYYY}/",
};

export const CREDENTIAL_LABEL: Record<CredentialType, string> = {
  TRANSCRIPT: "Transcript of records",
  MARKSHEET: "Statement of marks",
  PROVISIONAL_CERTIFICATE: "Provisional certificate",
  DEGREE_CERTIFICATE: "Degree certificate",
  MIGRATION_CERTIFICATE: "Migration certificate",
  BONAFIDE_CERTIFICATE: "Bonafide certificate",
  COURSE_COMPLETION: "Course completion certificate",
  RANK_CERTIFICATE: "Rank certificate",
  TRANSFER_CERTIFICATE: "Transfer certificate",
};

/** Snapshot of everything printed on a credential. Built from published data only. */
export async function buildPayload(tx: Tx, type: CredentialType, studentId: string, opts: { termId?: string | null; purpose?: string | null }) {
  const s = await tx.student.findUniqueOrThrow({ where: { id: studentId }, include: { program: true, batch: true, department: true } });
  const inst = await tx.institution.findFirstOrThrow();
  const base = {
    type,
    institution: { name: inst.name, shortName: inst.shortName, address: inst.address },
    student: { name: `${s.firstName} ${s.lastName}`, studentNo: s.studentNo, registrationNo: s.registrationNo, dateOfBirth: s.dateOfBirth?.toISOString().slice(0, 10) ?? null },
    programme: { code: s.program.code, name: s.program.name, level: s.program.level, batch: s.batch.code, department: s.department.name },
    status: s.status,
    issuedOn: new Date().toISOString().slice(0, 10),
  };
  if (type === "TRANSCRIPT" || type === "MARKSHEET" || type === "PROVISIONAL_CERTIFICATE" || type === "DEGREE_CERTIFICATE") {
    const results = await tx.courseResult.findMany({
      where: { studentId, isCurrent: true, publishedAt: { not: null }, ...(type === "MARKSHEET" && opts.termId ? { termId: opts.termId } : {}) },
      include: { course: { select: { code: true, title: true } }, run: { select: { term: { select: { id: true, name: true, startDate: true } } } } },
      orderBy: [{ run: { term: { startDate: "asc" } } }, { course: { code: "asc" } }],
    });
    if (!results.length) throw invalid("No published results are available for this credential.");
    const terms = await tx.termResult.findMany({ where: { studentId, isCurrent: true, publishedAt: { not: null } }, orderBy: { createdAt: "asc" } });
    const byTerm = new Map<string, { term: string; courses: unknown[] }>();
    for (const r of results) {
      const t = r.run.term;
      const entry = byTerm.get(t.id) ?? byTerm.set(t.id, { term: t.name, courses: [] }).get(t.id)!;
      entry.courses.push({ code: r.course.code, title: r.course.title, credits: r.credits, grade: r.grade, gradePoint: r.gradePoint, status: r.status, attempt: r.attempt, marks: r.totalMarks, maxMarks: r.maxMarks });
    }
    const lastTerm = terms.at(-1);
    return {
      ...base,
      terms: [...byTerm.entries()].map(([termId, v]) => ({ ...v, sgpa: terms.find((x) => x.termId === termId)?.sgpa ?? null })),
      cgpa: lastTerm?.cgpa ?? null,
      creditsEarned: lastTerm?.cumulativeCredits ?? null,
    };
  }
  return { ...base, purpose: opts.purpose ?? null, statement: certificateStatement(type, base) };
}

function certificateStatement(type: CredentialType, b: { student: { name: string; studentNo: string }; programme: { name: string; batch: string }; status: string; institution: { name: string } }) {
  switch (type) {
    case "BONAFIDE_CERTIFICATE":
      return `This is to certify that ${b.student.name} (${b.student.studentNo}) is a bonafide student of ${b.institution.name}, enrolled in ${b.programme.name} (${b.programme.batch}).`;
    case "COURSE_COMPLETION":
      return `This is to certify that ${b.student.name} (${b.student.studentNo}) has completed the ${b.programme.name} programme of study at ${b.institution.name}.`;
    case "MIGRATION_CERTIFICATE":
      return `${b.institution.name} has no objection to ${b.student.name} (${b.student.studentNo}) continuing their studies at another institution.`;
    case "TRANSFER_CERTIFICATE":
      return `${b.student.name} (${b.student.studentNo}) was a student of ${b.programme.name} at ${b.institution.name}. Academic status at the time of issue: ${b.status.toLowerCase().replace("_", " ")}.`;
    default:
      return `${b.student.name} (${b.student.studentNo}) — ${b.programme.name}.`;
  }
}

export async function issueCredential(tx: Tx, actor: { id: string | null; name: string }, type: CredentialType, studentId: string, opts: { termId?: string | null; purpose?: string | null } = {}) {
  const payload = await buildPayload(tx, type, studentId, opts);
  const { contentHash, seal } = sealPayload(payload);
  // A newer transcript/marksheet supersedes the previous one of the same kind (the old one still verifies as superseded).
  const previous = type === "TRANSCRIPT" || (type === "MARKSHEET" && opts.termId) ? await tx.issuedCredential.findMany({ where: { studentId, type, status: "ISSUED", ...(type === "MARKSHEET" ? { payload: { path: ["terms", "0", "term"], equals: (payload as { terms: { term: string }[] }).terms[0].term } } : {}) } }) : [];
  const serialNo = await nextNumber(tx, `credential.${type}`, { prefix: SERIAL_PREFIX[type], padding: 6 });
  const cred = await tx.issuedCredential.create({
    data: { type, serialNo, verificationCode: verificationCode(), studentId, title: CREDENTIAL_LABEL[type], payload: payload as Prisma.InputJsonValue, contentHash, seal, issuedById: actor.id },
  });
  if (previous.length) await tx.issuedCredential.updateMany({ where: { id: { in: previous.map((p) => p.id) } }, data: { status: "SUPERSEDED", supersededById: cred.id } });
  await audit({ actorId: actor.id, actorName: actor.name, action: "credential.issue", resourceType: "student", resourceId: studentId, summary: `${CREDENTIAL_LABEL[type]} ${serialNo}`, newValue: { credentialId: cred.id, contentHash } }, tx);
  await emitEvent(tx, { type: "CertificateIssued", aggregateType: "student", aggregateId: studentId, payload: { credentialId: cred.id, type }, actorId: actor.id });
  return cred;
}
