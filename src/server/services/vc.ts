import "server-only";
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, sign, verify, type JsonWebKey } from "node:crypto";
import { z } from "zod";
import type { CredentialType, Prisma } from "@/generated/prisma/client";
import { type AuthContext, can, isSuperAdmin } from "@/server/auth/current";
import { loadStudentFor } from "@/server/auth/access";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { decryptString, encryptString, sha256 } from "@/server/security/crypto";
import { audit } from "@/server/services/audit";
import { notify } from "@/server/services/notifications";

/**
 * Verifiable digital credentials.
 *
 * Certificates, badges and micro-credentials are issued as W3C Verifiable Credentials in the Open Badges
 * 3.0 format, encoded as VC-JWTs signed with the institution's Ed25519 key. The institution is identified
 * as did:web:<its domain>, whose DID document (/.well-known/did.json) publishes the public key, so any
 * wallet or verifier can check a credential without contacting us. Revocation is published at
 * /api/credentials/status/<id>.
 *
 * Students keep their credentials in the portal wallet, download them for a digital wallet, and create
 * expiring share links for employers. The learner record bundles every achievement into one credential.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });
const OB_CONTEXT = ["https://www.w3.org/2018/credentials/v1", "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json"];
const base = () => env.APP_URL.replace(/\/$/, "");

export function institutionDid(): string {
  const u = new URL(base());
  return `did:web:${u.host.replace(":", "%3A")}`;
}

// ───────────────────────── Keys and JWT ─────────────────────────

async function signingKey() {
  const k = await db.signingKey.findFirst({ where: { purpose: "credentials", active: true }, orderBy: { createdAt: "desc" } });
  if (k) return { kid: k.kid, privateKey: decryptString(k.privateKey) };
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const kid = `key-${randomBytes(6).toString("hex")}`;
  const jwk = { ...(publicKey.export({ format: "jwk" }) as JsonWebKey), kid, alg: "EdDSA" };
  const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  await db.signingKey.create({ data: { purpose: "credentials", kid, privateKey: encryptString(pem), publicJwk: jwk as unknown as Prisma.InputJsonValue } });
  return { kid, privateKey: pem };
}

export async function didDocument() {
  await signingKey();
  const did = institutionDid();
  const keys = await db.signingKey.findMany({ where: { purpose: "credentials" }, orderBy: { createdAt: "asc" } });
  const methods = keys.map((k) => ({ id: `${did}#${k.kid}`, type: "JsonWebKey2020", controller: did, publicKeyJwk: k.publicJwk }));
  return {
    "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/suites/jws-2020/v1"],
    id: did,
    verificationMethod: methods,
    assertionMethod: methods.filter((_, i) => keys[i].active).map((m) => m.id),
  };
}

const b64 = (x: Buffer | string) => Buffer.from(x).toString("base64url");

function signJwt(payload: Record<string, unknown>, pem: string, kid: string) {
  const header = b64(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: `${institutionDid()}#${kid}` }));
  const body = b64(JSON.stringify(payload));
  const sig = sign(null, Buffer.from(`${header}.${body}`), createPrivateKey(pem));
  return `${header}.${body}.${b64(sig)}`;
}

/** Verify a VC-JWT issued by this institution: signature, issuer, and our revocation record. */
export async function verifyVcJwt(jwt: string): Promise<{ valid: boolean; problems: string[]; vc: Record<string, unknown> | null; record: { id: string; revokedAt: Date | null } | null; issuedAt: Date | null }> {
  const problems: string[] = [];
  const parts = jwt.trim().split(".");
  if (parts.length !== 3) return { valid: false, problems: ["This is not a credential token."], vc: null, record: null, issuedAt: null };
  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  } catch {
    return { valid: false, problems: ["The credential could not be read."], vc: null, record: null, issuedAt: null };
  }
  if (header.alg !== "EdDSA") problems.push("Unsupported signature algorithm.");
  if (payload.iss !== institutionDid()) problems.push("The credential was not issued by this institution.");
  const kid = String(header.kid ?? "").split("#")[1];
  const key = kid ? await db.signingKey.findUnique({ where: { kid } }) : null;
  if (!key) problems.push("The signing key is unknown.");
  else {
    const ok = verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: key.publicJwk as JsonWebKey, format: "jwk" }), Buffer.from(parts[2], "base64url"));
    if (!ok) problems.push("The signature does not match: the credential was altered.");
  }
  const record = await db.verifiableCredential.findFirst({ where: { jwt: jwt.trim() }, select: { id: true, revokedAt: true } });
  if (!record) problems.push("The credential is not in the institution's register.");
  else if (record.revokedAt) problems.push(`The credential was revoked on ${record.revokedAt.toISOString().slice(0, 10)}.`);
  return { valid: problems.length === 0, problems, vc: (payload.vc as Record<string, unknown>) ?? null, record, issuedAt: typeof payload.nbf === "number" ? new Date(payload.nbf * 1000) : null };
}

// ───────────────────────── Issuing ─────────────────────────

async function issuerProfile() {
  const inst = await db.institution.findFirstOrThrow();
  return { id: institutionDid(), type: ["Profile"], name: inst.name, url: base() };
}

/** A stable, non-identifying subject id for the student, plus their name (the holder shares it deliberately). */
function subject(st: { id: string; firstName: string; lastName: string; studentNo: string }) {
  return { id: `urn:uuid:${sha256(`${env.APP_SECRET}:vc-subject:${st.id}`).slice(0, 32).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5")}`, type: ["AchievementSubject"], name: `${st.firstName} ${st.lastName}`, identifier: [{ type: "IdentityObject", identityHash: sha256(`${st.studentNo}`), identityType: "identifier", hashed: true }] };
}

async function signAndStore(kind: "ACADEMIC" | "BADGE" | "LEARNER_RECORD", studentId: string, types: string[], vcBody: Record<string, unknown>, links: { issuedCredentialId?: string; badgeAwardId?: string }, tx?: Prisma.TransactionClient) {
  const client = tx ?? db;
  const key = await signingKey();
  const id = randomUUID();
  const vcRowId = randomBytes(12).toString("hex");
  const now = Math.floor(Date.now() / 1000);
  const vc = {
    "@context": OB_CONTEXT,
    id: `urn:uuid:${id}`,
    type: types,
    issuer: await issuerProfile(),
    issuanceDate: new Date(now * 1000).toISOString(),
    credentialStatus: { id: `${base()}/api/credentials/status/${vcRowId}`, type: "1EdTechRevocationList" },
    ...vcBody,
  };
  const jwt = signJwt({ iss: institutionDid(), jti: vc.id, nbf: now, iat: now, sub: (vcBody.credentialSubject as { id: string }).id, vc }, key.privateKey, key.kid);
  return client.verifiableCredential.create({ data: { id: vcRowId, kind, studentId, types, jwt, issuedCredentialId: links.issuedCredentialId ?? null, badgeAwardId: links.badgeAwardId ?? null } });
}

const ACHIEVEMENT_TYPE: Partial<Record<CredentialType, string>> = {
  DEGREE_CERTIFICATE: "Degree", PROVISIONAL_CERTIFICATE: "Certificate", TRANSCRIPT: "Achievement", MARKSHEET: "Achievement", COURSE_COMPLETION: "Certificate", EXIT_CERTIFICATE: "Certificate", RANK_CERTIFICATE: "Award",
};

/** A verifiable copy of an issued certificate or transcript (created once; the same one is returned after). */
export async function academicVc(ctx: AuthContext, issuedCredentialId: string) {
  const c = await db.issuedCredential.findUnique({ where: { id: issuedCredentialId }, include: { student: true } });
  if (!c) throw notFound("Credential");
  const own = ctx.subject.studentId === c.studentId;
  if (!own) {
    await loadStudentFor(ctx, c.studentId);
    if (!can(ctx, "credential.issue", c.student.departmentId) && !isSuperAdmin(ctx)) throw forbidden();
  }
  if (c.status !== "ISSUED") throw workflowError("Only current credentials can be issued as verifiable credentials.");
  const existing = await db.verifiableCredential.findFirst({ where: { issuedCredentialId, revokedAt: null } });
  if (existing) return existing;
  const p = c.payload as { programme?: { name: string; code: string }; cgpa?: number | null; creditsEarned?: number | null; award?: { title: string } };
  const name = c.type === "EXIT_CERTIFICATE" && p.award ? p.award.title : c.type === "DEGREE_CERTIFICATE" && p.programme ? p.programme.name : c.title;
  const vc = await signAndStore("ACADEMIC", c.studentId, ["VerifiableCredential", "OpenBadgeCredential"], {
    name: `${c.title} — ${name}`,
    credentialSubject: {
      ...subject(c.student),
      achievement: {
        id: `${base()}/verify/${c.verificationCode}`, type: ["Achievement"], achievementType: ACHIEVEMENT_TYPE[c.type] ?? "Certificate", name,
        description: `${c.title} issued by the institution (serial ${c.serialNo}).`, criteria: { narrative: "Awarded on the published results of the institution's examinations." },
        ...(p.creditsEarned ? { creditsAvailable: p.creditsEarned } : {}),
      },
      ...(p.cgpa ? { result: [{ type: ["Result"], value: String(p.cgpa), resultDescription: "CGPA" }] } : {}),
    },
    evidence: [{ id: `${base()}/verify/${c.verificationCode}`, type: ["Evidence"], name: "Sealed record", narrative: `Serial ${c.serialNo}. The sealed original can be checked at the institution's verification page.` }],
  }, { issuedCredentialId });
  await audit({ ...actor(ctx), action: "vc.issue.academic", resourceType: "student", resourceId: c.studentId, summary: `${c.title} ${c.serialNo}` });
  return vc;
}

// ───────────────────────── Badges and micro-credentials ─────────────────────────

const badgeSchema = z.object({
  name: z.string().trim().min(3).max(120),
  kind: z.enum(["BADGE", "MICRO_CREDENTIAL", "CERTIFICATE_OF_PARTICIPATION"]),
  description: z.string().trim().min(10).max(2000),
  criteria: z.string().trim().min(10).max(2000),
  skills: z.string().trim().max(500).nullable().optional(),
  credits: z.number().positive().max(40).nullable().optional(),
  hours: z.number().positive().max(2000).nullable().optional(),
  active: z.boolean().default(true),
});

export async function saveBadge(ctx: AuthContext, id: string | null, raw: unknown) {
  if (!can(ctx, "badge.manage")) throw forbidden();
  const v = badgeSchema.parse(raw);
  const data = { name: v.name, kind: v.kind, description: v.description, criteria: v.criteria, skills: (v.skills ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 15), credits: v.credits ?? null, hours: v.hours ?? null, active: v.active };
  const b = id ? await db.badgeClass.update({ where: { id }, data }) : await db.badgeClass.create({ data: { ...data, departmentId: ctx.user.departmentId, createdById: ctx.user.id } });
  await audit({ ...actor(ctx), action: "badge.save", resourceType: "badgeClass", resourceId: b.id, summary: `${v.kind}: ${v.name}` });
  return b;
}

const KIND_TYPE = { BADGE: "Badge", MICRO_CREDENTIAL: "MicroCredential", CERTIFICATE_OF_PARTICIPATION: "Certificate" } as const;

/** Award a badge to students (by student number); each award is issued as a verifiable credential at once. */
export async function awardBadge(ctx: AuthContext, badgeId: string, raw: unknown, tx?: Prisma.TransactionClient) {
  const v = z.object({ studentNos: z.string().trim().min(3).max(20_000), evidence: z.string().trim().max(1000).nullable().optional() }).parse(raw);
  const b = await db.badgeClass.findUnique({ where: { id: badgeId } });
  if (!b || !b.active) throw notFound("Badge");
  const nos = [...new Set(v.studentNos.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean))];
  const students = await db.student.findMany({ where: { studentNo: { in: nos }, deletedAt: null } });
  const missing = nos.filter((n) => !students.some((s) => s.studentNo === n));
  if (missing.length) throw invalid(`Unknown student number(s): ${missing.slice(0, 10).join(", ")}`);
  for (const s of students) if (!can(ctx, "badge.manage", s.departmentId) && !isSuperAdmin(ctx)) throw forbidden(`You cannot award badges to ${s.studentNo}.`);
  let awarded = 0;
  const run = async (t: Prisma.TransactionClient) => {
    for (const s of students) {
      const exists = await t.badgeAward.findUnique({ where: { badgeId_studentId: { badgeId, studentId: s.id } } });
      if (exists && !exists.revokedAt) continue;
      const award = exists ? await t.badgeAward.update({ where: { id: exists.id }, data: { revokedAt: null, revokeReason: null, evidence: v.evidence ?? null, awardedById: ctx.user.id, awardedAt: new Date() } }) : await t.badgeAward.create({ data: { badgeId, studentId: s.id, evidence: v.evidence ?? null, awardedById: ctx.user.id } });
      await signAndStore("BADGE", s.id, ["VerifiableCredential", "OpenBadgeCredential"], {
        name: b.name,
        credentialSubject: {
          ...subject(s),
          achievement: {
            id: `${base()}/badges/${b.id}`, type: ["Achievement"], achievementType: KIND_TYPE[b.kind], name: b.name, description: b.description, criteria: { narrative: b.criteria },
            ...(b.skills.length ? { tag: b.skills } : {}), ...(b.credits ? { creditsAvailable: b.credits } : {}), ...(b.hours ? { fieldOfStudy: `${b.hours} hours` } : {}),
          },
        },
        ...(v.evidence ? { evidence: [{ type: ["Evidence"], narrative: v.evidence }] } : {}),
      }, { badgeAwardId: award.id }, t);
      awarded++;
    }
    await notify({ userIds: students.map((s) => s.userId), type: "badge.awarded", title: `You earned: ${b.name}`, body: "It is in your credential wallet, ready to share.", link: "/portal/wallet", email: false }, t);
    await audit({ ...actor(ctx), action: "badge.award", resourceType: "badgeClass", resourceId: badgeId, summary: `${b.name}: ${awarded} student(s)` }, t);
  };
  if (tx) await run(tx);
  else await db.$transaction(run);
  return awarded;
}

/** Issue the verifiable credential for any current award that has none yet (e.g. awards loaded in bulk). */
export async function ensureBadgeVcs(studentId: string) {
  const awards = await db.badgeAward.findMany({ where: { studentId, revokedAt: null }, include: { badge: true, student: true } });
  const have = new Set((await db.verifiableCredential.findMany({ where: { studentId, badgeAwardId: { in: awards.map((a) => a.id) }, revokedAt: null }, select: { badgeAwardId: true } })).map((v) => v.badgeAwardId));
  for (const a of awards.filter((x) => !have.has(x.id))) {
    const b = a.badge;
    await signAndStore("BADGE", studentId, ["VerifiableCredential", "OpenBadgeCredential"], {
      name: b.name,
      credentialSubject: { ...subject(a.student), achievement: { id: `${base()}/badges/${b.id}`, type: ["Achievement"], achievementType: KIND_TYPE[b.kind], name: b.name, description: b.description, criteria: { narrative: b.criteria }, ...(b.skills.length ? { tag: b.skills } : {}), ...(b.credits ? { creditsAvailable: b.credits } : {}) } },
      ...(a.evidence ? { evidence: [{ type: ["Evidence"], narrative: a.evidence }] } : {}),
    }, { badgeAwardId: a.id });
  }
}

export async function revokeBadgeAward(ctx: AuthContext, awardId: string, reason: string) {
  const a = await db.badgeAward.findUnique({ where: { id: awardId }, include: { student: true, badge: true } });
  if (!a || a.revokedAt) throw notFound("Award");
  if (!can(ctx, "badge.manage", a.student.departmentId) && !isSuperAdmin(ctx)) throw forbidden();
  if (reason.trim().length < 5) throw invalid("Give the reason for revoking.");
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.badgeAward.update({ where: { id: awardId }, data: { revokedAt: now, revokeReason: reason.trim() } });
    await tx.verifiableCredential.updateMany({ where: { badgeAwardId: awardId, revokedAt: null }, data: { revokedAt: now } });
    await audit({ ...actor(ctx), action: "badge.revoke", resourceType: "badgeAward", resourceId: awardId, summary: `${a.badge.name} — ${a.student.studentNo}: ${reason}` }, tx);
  });
}

/** Revoke the verifiable copies of an issued credential (called when the credential itself is revoked). */
export async function revokeAcademicVcs(tx: Prisma.TransactionClient, issuedCredentialId: string) {
  await tx.verifiableCredential.updateMany({ where: { issuedCredentialId, revokedAt: null }, data: { revokedAt: new Date() } });
}

// ───────────────────────── Learner record ─────────────────────────

/** One credential listing everything the student has achieved: published course results, certificates and badges. */
export async function learnerRecord(ctx: AuthContext, studentId: string) {
  if (ctx.subject.studentId !== studentId) throw forbidden();
  const st = await db.student.findUniqueOrThrow({ where: { id: studentId }, include: { program: true } });
  const [results, creds, badges, terms] = await Promise.all([
    db.courseResult.findMany({ where: { studentId, isCurrent: true, publishedAt: { not: null }, status: "PASS" }, include: { course: { select: { code: true, title: true } }, run: { select: { term: { select: { name: true } } } } }, orderBy: { createdAt: "asc" } }),
    db.issuedCredential.findMany({ where: { studentId, status: "ISSUED" }, orderBy: { issuedAt: "asc" } }),
    db.badgeAward.findMany({ where: { studentId, revokedAt: null }, include: { badge: true }, orderBy: { awardedAt: "asc" } }),
    db.termResult.findFirst({ where: { studentId, isCurrent: true, publishedAt: { not: null } }, orderBy: { createdAt: "desc" } }),
  ]);
  const achievements = [
    ...results.map((r) => ({ type: ["Achievement"], achievementType: "Course", name: `${r.course.code} ${r.course.title}`, creditsAvailable: r.credits, result: [{ type: ["Result"], value: r.grade }], term: r.run.term.name })),
    ...creds.map((c) => ({ type: ["Achievement"], achievementType: ACHIEVEMENT_TYPE[c.type] ?? "Certificate", name: c.title, id: `${base()}/verify/${c.verificationCode}` })),
    ...badges.map((b) => ({ type: ["Achievement"], achievementType: KIND_TYPE[b.badge.kind], name: b.badge.name, description: b.badge.description, ...(b.badge.credits ? { creditsAvailable: b.badge.credits } : {}), ...(b.badge.skills.length ? { tag: b.badge.skills } : {}) })),
  ];
  if (!achievements.length) throw workflowError("There is nothing in your record yet.");
  const vc = await signAndStore("LEARNER_RECORD", studentId, ["VerifiableCredential", "ClrCredential"], {
    name: `Learner record — ${st.firstName} ${st.lastName}`,
    credentialSubject: { ...subject(st), type: ["ClrSubject"], programme: st.program.name, ...(terms?.cgpa ? { cgpa: terms.cgpa } : {}), achievements },
  }, {});
  await audit({ ...actor(ctx), action: "vc.issue.learnerRecord", resourceType: "student", resourceId: studentId, summary: `${achievements.length} achievement(s)` });
  return vc;
}

// ───────────────────────── Sharing ─────────────────────────

export async function createShare(ctx: AuthContext, vcId: string, raw: unknown) {
  const v = z.object({ days: z.number().int().min(1).max(365), label: z.string().trim().max(80).nullable().optional() }).parse(raw);
  const vc = await db.verifiableCredential.findUnique({ where: { id: vcId } });
  if (!vc || vc.studentId !== ctx.subject.studentId) throw notFound("Credential");
  if (vc.revokedAt) throw workflowError("A revoked credential cannot be shared.");
  const token = randomBytes(18).toString("base64url");
  await db.credentialShare.create({ data: { vcId, tokenHash: sha256(token), label: v.label ?? null, expiresAt: new Date(Date.now() + v.days * 86_400_000) } });
  await audit({ ...actor(ctx), action: "vc.share", resourceType: "verifiableCredential", resourceId: vcId, summary: `${v.days} day(s)${v.label ? ` for ${v.label}` : ""}` });
  return `${base()}/share/${token}`;
}

export async function revokeShare(ctx: AuthContext, shareId: string) {
  const s = await db.credentialShare.findUnique({ where: { id: shareId }, include: { vc: { select: { studentId: true } } } });
  if (!s || s.vc.studentId !== ctx.subject.studentId) throw notFound("Share");
  await db.credentialShare.update({ where: { id: shareId }, data: { revokedAt: new Date() } });
}

/** What an employer sees at a share link (no sign-in): the credential and the verification result. */
export async function openShare(token: string) {
  const s = await db.credentialShare.findUnique({ where: { tokenHash: sha256(token) }, include: { vc: true } });
  if (!s || s.revokedAt || s.expiresAt < new Date()) return null;
  await db.credentialShare.update({ where: { id: s.id }, data: { views: { increment: 1 }, lastViewedAt: new Date() } });
  const check = await verifyVcJwt(s.vc.jwt);
  return { share: s, jwt: s.vc.jwt, check };
}
