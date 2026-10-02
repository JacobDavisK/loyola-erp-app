import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { degreeProgress } from "@/server/services/curriculum";
import { generateNadBatch, loadNadBatch, setApaarId, setNadBatchStatus, verifyApaarId } from "@/server/services/nad";
import { creditsEarned, exitOptions, requestExit, reviewExternalCredit, saveExitAward, submitExternalCredit } from "@/server/services/nep";
import { offeringAttainment, programAttainment, setComponentOutcomes, setCoPoMatrix } from "@/server/services/obe";
import {
  applyRetention, decideConsent, fulfilAccessRequest, hasConsent, pendingRequiredNotices, publishNotice, raiseDataRequest, reportBreach, saveRetentionRule,
  updateBreach, updateDataRequest,
} from "@/server/services/privacy";
import { requestStatusChange } from "@/server/services/students";
import { decideTask } from "@/server/services/workflow";
import { as } from "./helpers";

const DAY = 86_400_000;
const pdf = () => new File([Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF")], "certificate.pdf", { type: "application/pdf" });

async function approveAll(instanceId: string) {
  for (let i = 0; i < 5; i++) {
    const t = await db.workflowTask.findFirst({ where: { instanceId, status: "PENDING" }, include: { assignee: { select: { email: true } } } });
    if (!t) return;
    await decideTask(await as(t.assignee.email.replace("@example.edu", "")), t.id, { decision: "approve" });
  }
}

describe("APAAR and ABC / NAD uploads", () => {
  it("lets a student record their APAAR ID, the office verify it, and locks it after verification", async () => {
    const student = await as("student");
    const id = student.subject.studentId!;
    await setApaarId(student, id, "9876 5432 1098");
    expect((await db.student.findUniqueOrThrow({ where: { id } })).apaarId).toBe("987654321098");
    await expect(setApaarId(student, id, "12345")).rejects.toThrow(/12 digits/);
    await expect(verifyApaarId(student, id, true)).rejects.toThrow(/permission/);
    await verifyApaarId(await as("registrar"), id, true);
    await expect(setApaarId(student, id, "111122223333")).rejects.toThrow(/verified/);
    // Another record cannot reuse the ID.
    const other = await db.student.findFirstOrThrow({ where: { id: { not: id }, departmentId: (await db.student.findUniqueOrThrow({ where: { id } })).departmentId } });
    await expect(setApaarId(await as("registrar"), other.id, "987654321098")).rejects.toThrow(/already/);
  });

  it("builds an ABC credit file from published results, holding back students without a verified ID", async () => {
    const reg = await as("registrar");
    const run = await db.resultRun.findFirstOrThrow({ where: { courseResults: { some: { publishedAt: { not: null }, status: "PASS" } } } });
    const b = await generateNadBatch(reg, { kind: "ABC_CREDITS", termId: run.termId });
    const { rows, skipped } = await loadNadBatch(reg, b.id);
    expect(rows.length + skipped.length).toBeGreaterThan(0);
    for (const r of rows) expect(String(r.ABC_ACCOUNT_ID)).toMatch(/^\d{12}$/);
    const verified = new Set((await db.student.findMany({ where: { apaarVerifiedAt: { not: null } }, select: { studentNo: true } })).map((s) => s.studentNo));
    for (const r of rows) expect(verified.has(String(r.RROLL))).toBe(true);
    await expect(setNadBatchStatus(reg, b.id, { status: "ACKNOWLEDGED" })).rejects.toThrow(/cannot/);
    await setNadBatchStatus(reg, b.id, { status: "SUBMITTED" });
    await expect(setNadBatchStatus(reg, b.id, { status: "ACKNOWLEDGED" })).rejects.toThrow(/reference/);
    await setNadBatchStatus(reg, b.id, { status: "ACKNOWLEDGED", reference: "ABC-UPL-2026-0042" });
    await expect(generateNadBatch(await as("faculty.cs1"), { kind: "NAD_DEGREE" })).rejects.toThrow(/permission/);
  });
});

describe("NEP multiple exit and credit transfer", () => {
  it("approves an exit through the HoD and the Registrar, issues the certificate and allows re-entry", async () => {
    const reg = await as("registrar");
    const st = await db.student.findFirstOrThrow({ where: { status: "ACTIVE", program: { code: "BCA" }, courseResults: { some: { status: "PASS", publishedAt: { not: null } } }, exitRequests: { none: {} } } });
    const credits = (await creditsEarned(st.id)).total;
    expect(credits).toBeGreaterThan(0);
    await expect(saveExitAward(await as("hod.cs"), st.programId, null, { level: 9, title: "Test award", minCredits: 0, minYears: 0, reentryYears: 5 })).rejects.toThrow(/permission/);
    const award = await saveExitAward(reg, st.programId, null, { level: 9, title: "Certificate of credits (test)", minCredits: 1, minYears: 0, reentryYears: 5 });
    const tooHigh = await saveExitAward(reg, st.programId, null, { level: 8, title: "Unreachable", minCredits: 400, minYears: 0, reentryYears: 5 });
    await expect(requestExit(reg, st.id, { awardId: tooHigh.id, reason: "Leaving for employment opportunities." })).rejects.toThrow(/Not yet eligible/);
    const opts = await exitOptions(reg, st.id);
    expect(opts.awards.find((a) => a.id === award.id)?.eligible).toBe(true);
    const req = await requestExit(reg, st.id, { awardId: award.id, reason: "Leaving for employment opportunities." });
    await expect(requestExit(reg, st.id, { awardId: award.id, reason: "Second request should fail." })).rejects.toThrow(/already/);
    await approveAll(req.workflowId ?? (await db.exitRequest.findUniqueOrThrow({ where: { id: req.id } })).workflowId!);
    const done = await db.exitRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(done.status).toBe("APPROVED");
    expect((await db.student.findUniqueOrThrow({ where: { id: st.id } })).status).toBe("EXITED");
    const cred = await db.issuedCredential.findUniqueOrThrow({ where: { id: done.credentialId! } });
    expect(cred.type).toBe("EXIT_CERTIFICATE");
    expect((cred.payload as { award: { title: string } }).award.title).toBe("Certificate of credits (test)");
    expect(done.reentryUntil!.getTime()).toBeGreaterThan(Date.now() + 4 * 365 * DAY);
    // Re-entry within the window goes through the normal status workflow.
    await requestStatusChange(reg, st.id, { to: "ACTIVE", reason: "Re-entering the programme with earned credits.", effectiveOn: new Date() });
    await db.exitRequest.update({ where: { id: req.id }, data: { reentryUntil: new Date(Date.now() - DAY) } });
    const st2 = await db.student.findFirstOrThrow({ where: { id: st.id } });
    expect(st2.status).toBe("EXITED");
  });

  it("reviews transfer credits in the department, counts them in degree progress and enforces the cap", async () => {
    const student = await as("student");
    const sid = student.subject.studentId!;
    const f = new FormData();
    for (const [k, v] of Object.entries({ source: "SWAYAM", provider: "SWAYAM (IIT Bombay)", courseTitle: "Design Thinking", credits: "2", completedOn: "2026-05-30" })) f.set(k, v);
    f.set("file", pdf());
    const e = await submitExternalCredit(student, sid, f);
    await expect(reviewExternalCredit(student, e.id, { decision: "APPROVED" })).rejects.toThrow(/permission/);
    await expect(reviewExternalCredit(await as("hod.commerce"), e.id, { decision: "APPROVED" })).rejects.toThrow(/permission/);
    const before = (await degreeProgress(await as("registrar"), sid))!;
    await reviewExternalCredit(await as("hod.cs"), e.id, { decision: "APPROVED", remarks: "Open elective" });
    const after = (await degreeProgress(await as("registrar"), sid))!;
    expect(after.audit.earnedCredits).toBe(before.audit.earnedCredits + 2);
    // A large claim is refused beyond 40% of the programme.
    const big = new FormData();
    for (const [k, v] of Object.entries({ source: "INSTITUTION", provider: "Another university", courseTitle: "Transferred semester", credits: "40", completedOn: "2026-04-30" })) big.set(k, v);
    big.set("file", pdf());
    const e2 = await submitExternalCredit(await as("registrar"), sid, big);
    await db.externalCredit.update({ where: { id: e.id }, data: { credits: 30 } });
    await expect(reviewExternalCredit(await as("hod.cs"), e2.id, { decision: "APPROVED" })).rejects.toThrow(/more transfer credit/);
    await expect(reviewExternalCredit(await as("hod.cs"), e2.id, { decision: "REJECTED" })).rejects.toThrow(/why/);
  });
});

describe("outcome-based education", () => {
  it("computes CO attainment from marks and rolls it up to programme outcomes", async () => {
    const o = await db.courseOffering.findFirstOrThrow({ where: { components: { some: { outcomes: { some: {} }, marks: { some: {} } } } }, include: { instructors: true, course: true } });
    const a = await offeringAttainment(null, o.id);
    expect(a.attainment.length).toBeGreaterThan(0);
    expect(a.attainment.some((r) => r.final !== null)).toBe(true);
    for (const r of a.attainment) {
      if (r.final === null) continue;
      expect(r.final).toBeGreaterThanOrEqual(0);
      expect(r.final).toBeLessThanOrEqual(3);
    }
    const p = await programAttainment(await as("hod.cs"), o.course.programId);
    expect(p.overall.some((x) => x.value !== null)).toBe(true);
    // Only teachers of the class (or OBE coordinators) map components; the CO–PO matrix needs obe.manage.
    const comp = await db.assessmentComponent.findFirstOrThrow({ where: { offeringId: o.id } });
    const cos = await db.learningOutcome.findMany({ where: { courseId: o.courseId } });
    await expect(setComponentOutcomes(await as("faculty.com1"), comp.id, [cos[0].id])).rejects.toThrow(/permission/);
    const teacher = await db.user.findUniqueOrThrow({ where: { id: o.instructors[0].userId } });
    await setComponentOutcomes(await as(teacher.email.replace("@example.edu", "")), comp.id, [cos[0].id]);
    expect(await db.componentOutcome.count({ where: { componentId: comp.id } })).toBe(1);
    const po = await db.programOutcome.findFirstOrThrow({ where: { programId: o.course.programId } });
    await expect(setCoPoMatrix(await as("faculty.cs1"), o.courseId, { [`${cos[0].id}:${po.id}`]: 3 })).rejects.toThrow(/permission/);
    await setCoPoMatrix(await as("hod.cs"), o.courseId, { [`${cos[0].id}:${po.id}`]: 3 });
    expect(await db.coPoMapping.count({ where: { outcomeId: { in: cos.map((c) => c.id) } } })).toBe(1);
  });
});

describe("data protection", () => {
  it("gates required notices, records consent append-only and lets guardians decide for minors", async () => {
    const dpo = await as("dpo");
    const student = await as("student");
    const n = await publishNotice(dpo, { key: "student.records", title: "How we use your student records (revised)", purpose: "Running your studies.", body: "Updated notice text describing the processing of student records.", audience: "STUDENT", required: true });
    expect(n.version).toBe(2);
    expect((await pendingRequiredNotices(student)).map((x) => x.id)).toContain(n.id);
    await expect(decideConsent(student, { noticeId: n.id, decision: "WITHDRAWN" })).rejects.toThrow(/grievance/);
    await decideConsent(student, { noticeId: n.id, decision: "GRANTED" });
    expect(await pendingRequiredNotices(student)).toHaveLength(0);
    const rec = await db.consentRecord.findFirstOrThrow({ where: { noticeId: n.id } });
    await expect(db.consentRecord.update({ where: { id: rec.id }, data: { decision: "WITHDRAWN" } })).rejects.toThrow();
    // Optional purpose: grant then withdraw.
    const opt = await db.consentNotice.findFirstOrThrow({ where: { key: "directory.listing", active: true } });
    await decideConsent(student, { noticeId: opt.id, decision: "GRANTED" });
    expect(await hasConsent(student.user.id, "directory.listing")).toBe(true);
    await decideConsent(student, { noticeId: opt.id, decision: "WITHDRAWN" });
    expect(await hasConsent(student.user.id, "directory.listing")).toBe(false);
    // Guardian decides only while the ward is a minor.
    const parent = await as("parent");
    const ward = parent.subject.wardStudentIds[0];
    await db.student.update({ where: { id: ward }, data: { dateOfBirth: new Date(Date.now() - 16 * 365 * DAY) } });
    await decideConsent(parent, { noticeId: opt.id, decision: "GRANTED", studentId: ward });
    await db.student.update({ where: { id: ward }, data: { dateOfBirth: new Date("2003-05-01") } });
    await expect(decideConsent(parent, { noticeId: opt.id, decision: "GRANTED", studentId: ward })).rejects.toThrow(/adult/);
  });

  it("works a data-principal request to completion with a personal-data export", async () => {
    const student = await as("student");
    const dpo = await as("dpo");
    const r = await raiseDataRequest(student, { type: "ACCESS", details: "Please send me a copy of all my personal data." });
    await expect(raiseDataRequest(student, { type: "ACCESS", details: "A second access request at the same time." })).rejects.toThrow(/already/);
    expect(r.dueAt.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
    await expect(updateDataRequest(student, r.id, { status: "COMPLETED", response: "Done by myself." })).rejects.toThrow(/permission/);
    await fulfilAccessRequest(dpo, r.id);
    const withExport = await db.dataRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(withExport.exportAssetId).toBeTruthy();
    expect((await db.fileAsset.findUniqueOrThrow({ where: { id: withExport.exportAssetId! } })).mimeType).toBe("application/json");
    await expect(updateDataRequest(dpo, r.id, { status: "COMPLETED", response: "short" })).rejects.toThrow(/response/);
    await updateDataRequest(dpo, r.id, { status: "COMPLETED", response: "Your personal-data export is attached to this request." });
    await expect(updateDataRequest(dpo, r.id, { status: "REJECTED", response: "Changing my mind after completion." })).rejects.toThrow(/cannot/);
  });

  it("tracks a breach to closure and applies retention", async () => {
    const dpo = await as("dpo");
    const b = await reportBreach(await as("faculty.cs1"), { title: "Laptop with exported marks lost", description: "A staff laptop holding an exported marks file was lost in transit.", detectedAt: new Date(Date.now() - 3600_000), severity: "HIGH", dataCategories: "Names, marks", affectedCount: 60 });
    await expect(updateBreach(dpo, b.id, { status: "NOTIFIED" })).rejects.toThrow(/informed/);
    await updateBreach(dpo, b.id, { status: "CONTAINED", containment: "Remote wipe issued; the file was encrypted at rest." });
    await updateBreach(dpo, b.id, { status: "NOTIFIED", boardNotifiedAt: new Date(), usersNotifiedAt: new Date() });
    await updateBreach(dpo, b.id, { status: "CLOSED" });
    await db.loginAttempt.create({ data: { identifier: "old@example.edu", ip: "10.0.0.1", success: false, createdAt: new Date(Date.now() - 400 * DAY) } });
    await saveRetentionRule(dpo, { dataset: "login_attempts", retainDays: 180, active: true });
    expect(await applyRetention()).toBeGreaterThan(0);
    expect(await db.loginAttempt.count({ where: { createdAt: { lt: new Date(Date.now() - 180 * DAY) } } })).toBe(0);
    await expect(saveRetentionRule(dpo, { dataset: "course_results", retainDays: 30, active: true })).rejects.toThrow();
  });
});
