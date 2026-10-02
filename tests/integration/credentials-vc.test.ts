import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { issueCredential } from "@/server/services/credential-issue";
import { revokeCredential } from "@/server/services/credentials";
import { academicVc, awardBadge, createShare, didDocument, ensureBadgeVcs, learnerRecord, openShare, revokeBadgeAward, saveBadge, verifyVcJwt } from "@/server/services/vc";
import { as } from "./helpers";

const decode = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

describe("verifiable credentials", () => {
  it("publishes a DID document and issues Open Badges 3.0 credentials that verify", async () => {
    const doc = await didDocument();
    expect(doc.id).toMatch(/^did:web:/);
    expect(doc.verificationMethod[0].publicKeyJwk).toMatchObject({ kty: "OKP", crv: "Ed25519" });

    const reg = await as("registrar");
    const b = await saveBadge(reg, null, { name: "Data Visualisation", kind: "MICRO_CREDENTIAL", description: "Charts and dashboards with Python.", criteria: "Complete the module and the project.", skills: "Python, Charts", credits: 1, active: true });
    await expect(saveBadge(await as("student"), null, { name: "Self-awarded", kind: "BADGE", description: "Should not be possible.", criteria: "None at all, really.", active: true })).rejects.toThrow(/permission/);
    const st = await db.student.findFirstOrThrow({ where: { user: { email: "student@example.edu" } } });
    await expect(awardBadge(reg, b.id, { studentNos: "NOSUCH123" })).rejects.toThrow(/Unknown/);
    expect(await awardBadge(reg, b.id, { studentNos: st.studentNo, evidence: "Project submitted" })).toBe(1);
    const vc = await db.verifiableCredential.findFirstOrThrow({ where: { studentId: st.id, kind: "BADGE" }, orderBy: { issuedAt: "desc" } });
    const payload = decode(vc.jwt);
    expect(payload.vc.type).toContain("OpenBadgeCredential");
    expect(payload.vc.credentialSubject.achievement.achievementType).toBe("MicroCredential");
    expect(payload.vc.credentialSubject.identifier[0].hashed).toBe(true);
    const ok = await verifyVcJwt(vc.jwt);
    expect(ok.valid).toBe(true);

    // Tampering breaks the signature.
    const parts = vc.jwt.split(".");
    const forged = { ...payload, vc: { ...payload.vc, name: "Doctor of Everything" } };
    const tampered = `${parts[0]}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${parts[2]}`;
    expect((await verifyVcJwt(tampered)).problems.join(" ")).toMatch(/altered/);

    // Revoking the award revokes the credential; signed rows cannot be edited.
    const award = await db.badgeAward.findFirstOrThrow({ where: { badgeId: b.id, studentId: st.id } });
    await expect(db.verifiableCredential.update({ where: { id: vc.id }, data: { jwt: "x.y.z" } })).rejects.toThrow();
    await revokeBadgeAward(reg, award.id, "Awarded in error");
    expect((await verifyVcJwt(vc.jwt)).problems.join(" ")).toMatch(/revoked/);
  });

  it("turns an issued certificate into a verifiable credential and follows its revocation", async () => {
    const student = await as("student");
    const st = await db.student.findUniqueOrThrow({ where: { id: student.subject.studentId! } });
    const cred = await db.$transaction((tx) => issueCredential(tx, { id: null, name: "Test" }, "BONAFIDE_CERTIFICATE", st.id, { purpose: "Bank account" }));
    const vc = await academicVc(student, cred.id);
    expect((await academicVc(student, cred.id)).id).toBe(vc.id); // created once
    await expect(academicVc(await as("parent"), cred.id)).rejects.toThrow();
    expect((await verifyVcJwt(vc.jwt)).valid).toBe(true);
    await revokeCredential(await as("registrar"), cred.id, "Issued with the wrong purpose");
    expect((await verifyVcJwt(vc.jwt)).valid).toBe(false);
  });

  it("issues a learner record and shares a credential by an expiring link", async () => {
    const student = await as("student");
    const sid = student.subject.studentId!;
    await ensureBadgeVcs(sid);
    const clr = await learnerRecord(student, sid);
    const p = decode(clr.jwt);
    expect(p.vc.type).toContain("ClrCredential");
    expect(p.vc.credentialSubject.achievements.length).toBeGreaterThan(0);
    await expect(learnerRecord(await as("registrar"), sid)).rejects.toThrow();
    const url = await createShare(student, clr.id, { days: 7, label: "Acme Ltd" });
    const token = url.split("/share/")[1];
    const opened = await openShare(token);
    expect(opened?.check.valid).toBe(true);
    expect((await db.credentialShare.findFirstOrThrow({ where: { vcId: clr.id } })).views).toBe(1);
    expect(await openShare("not-a-real-token")).toBeNull();
    await expect(createShare(await as("parent"), clr.id, { days: 7 })).rejects.toThrow();
  });
});
