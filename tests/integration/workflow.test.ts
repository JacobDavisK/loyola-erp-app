import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createAssignment, respondToAssignment } from "@/server/services/assignments";
import { verifyAuditChain } from "@/server/services/audit";
import { exportPaperPdf } from "@/server/services/exports";
import {
  addPaperComment, blueprintSpec, builderQuestionsForTest, computeScrutiny, moderatorReplaceItem, previewGeneration, savePaperStructure, snapshotOf, transitionPaper,
} from "./service-shims";
import { createQuestion, searchQuestions } from "@/server/services/questions";
import { as, paperByCode } from "./helpers";

describe("question bank", () => {
  it("creates a versioned question and finds it with full-text search", async () => {
    const setter = await as("setter");
    const course = await db.course.findFirstOrThrow({ where: { code: "BCS301" }, include: { units: true } });
    const q = await createQuestion(setter, {
      courseId: course.id, unitId: course.units[0].id, type: "SHORT", bloom: "UNDERSTAND", difficulty: "MODERATE", marks: 5, estimatedMinutes: 9,
      body: "Explain amortised analysis of dynamic arrays with the doubling strategy.", keywords: ["amortised"], tags: ["conceptual"],
    });
    expect(q.status).toBe("PENDING_REVIEW"); // setters cannot self-approve into the bank
    const res = await searchQuestions(setter, { q: "amortised doubling", courseId: course.id, status: "PENDING_REVIEW" });
    expect(res.rows.some((r) => r.id === q.id)).toBe(true);
    expect((await db.questionVersion.count({ where: { questionId: q.id } }))).toBe(1);
  });

  it("rejects malformed equations at authoring time", async () => {
    const setter = await as("setter");
    const course = await db.course.findFirstOrThrow({ where: { code: "BCS301" }, include: { units: true } });
    await expect(
      createQuestion(setter, { courseId: course.id, unitId: course.units[0].id, type: "SHORT", bloom: "APPLY", difficulty: "EASY", marks: 2, estimatedMinutes: 3, body: "Evaluate $\\frac{1}{$ now." }),
    ).rejects.toThrow();
  });

  it("prevents authoring in another department's course", async () => {
    const setter = await as("setter"); // Computer Science
    const course = await db.course.findFirstOrThrow({ where: { code: "BCM301" }, include: { units: true } });
    await expect(
      createQuestion(setter, { courseId: course.id, unitId: course.units[0].id, type: "SHORT", bloom: "APPLY", difficulty: "EASY", marks: 2, estimatedMinutes: 3, body: "Define goodwill for accounting purposes." }),
    ).rejects.toThrow(/cannot add questions/);
  });
});

describe("end-to-end paper lifecycle", () => {
  it("assign → accept → generate → submit → moderate → scrutinise → approve → lock", async () => {
    const controller = await as("controller");
    const setter = await as("setter2");
    const moderator = await as("moderator");
    const scrutiny = await as("scrutiny");
    const approver = await as("approver");

    // 1. Appoint and accept (BCS304 has no paper yet for setter2 → use set B)
    const exam = await db.examination.findFirstOrThrow({ where: { course: { code: "BCS303" }, session: { code: "NOV2026" } } });
    const deadline = new Date(Date.now() + 10 * 86_400_000);
    const a = await createAssignment(controller, { examinationId: exam.id, setterId: setter.user.id, setLabel: "B", deadline });
    const paper = await respondToAssignment(setter, a.id, true);
    expect(paper?.status).toBe("DRAFT");
    const paperId = paper!.id;

    // 2. Generate from blueprint and save (allow reuse: set A already consumed the fresh questions)
    const { result } = await previewGeneration(setter, paperId, { seed: 11, allowRecentReuse: true });
    const snap0 = await snapshotOf(paperId);
    const bp = (await blueprintSpec(paper!.blueprintId))!;
    const items = await builderQuestionsForTest(setter, exam.courseId, Object.values(result.sections).flat());
    const byId = new Map(items.map((i) => [i.questionId, i]));
    await savePaperStructure(setter, paperId, {
      revision: 0,
      instructions: "Answer as directed.",
      sections: snap0.sections.map((s) => ({
        id: s.id, label: s.label, title: s.title, instructions: s.instructions, attemptCount: s.attemptCount, marksPerQuestion: s.marksPerQuestion,
        items: (result.sections[s.label] ?? []).map((qid) => ({ questionId: qid, marks: byId.get(qid)!.marks })),
      })),
    });
    expect(bp.totalMarks).toBe(75);

    // 3. Submit → version 1.0
    const sub = await transitionPaper(setter, paperId, "submit");
    expect(sub).toMatchObject({ status: "SUBMITTED", version: "1.0" });

    // 4. Setter can no longer edit
    await expect(savePaperStructure(setter, paperId, { revision: 99, instructions: null, sections: [{ label: "A", title: "x", instructions: null, attemptCount: null, marksPerQuestion: null, items: [] }] })).rejects.toThrow();

    // 5. Moderation: start, comment, replace a question, approve
    await transitionPaper(moderator, paperId, "start_moderation");
    const snap1 = await snapshotOf(paperId);
    const target = snap1.sections[0].items[0];
    await addPaperComment(moderator, paperId, { itemId: target.itemId, kind: "ISSUE", body: "Wording is ambiguous." });
    const replacement = await db.question.findFirstOrThrow({
      where: { courseId: exam.courseId, marks: target.marks, status: "ACTIVE", id: { notIn: snap1.sections.flatMap((s) => s.items.map((i) => i.questionId)) } },
    });
    await moderatorReplaceItem(moderator, paperId, target.itemId, replacement.id, "Clearer wording");
    const mod = await transitionPaper(moderator, paperId, "moderation_approve", { moderationChecklist: { relevance: { ok: true } } });
    expect(mod).toMatchObject({ status: "UNDER_SCRUTINY", version: "1.1" });

    // 6. Scrutiny (server recomputes the checks)
    const scr = await computeScrutiny(paperId);
    expect(scr.checks.find((c) => c.key === "totalMarks")?.ok).toBe(true);
    await transitionPaper(scrutiny, paperId, "scrutiny_pass");

    // 7. Approval & lock
    await transitionPaper(approver, paperId, "approve", { note: "Approved" });
    const locked = await transitionPaper(approver, paperId, "lock");
    expect(locked).toMatchObject({ status: "LOCKED", version: "2.0 FINAL" });

    const final = await db.questionPaperVersion.findFirstOrThrow({ where: { paperId, isFinal: true } });
    const p = await db.questionPaper.findUniqueOrThrow({ where: { id: paperId } });
    expect(p.finalHash).toBe(final.contentHash);
    expect(await db.questionUsage.count({ where: { paperId } })).toBe(22);
    expect(await db.paperTransition.count({ where: { paperId } })).toBe(6); // submit, start, approve-moderation, pass-scrutiny, approve, lock

    // 8. Locked content is immutable at the database level
    await expect(db.questionPaperItem.updateMany({ where: { section: { paperId } }, data: { marks: 1 } })).rejects.toThrow(/cannot be edited/);
    await expect(db.questionPaperVersion.update({ where: { id: final.id }, data: { reason: "tamper" } })).rejects.toThrow(/immutable/);

    // 9. Final PDF: only for authorised roles, rendered from the FINAL version
    const pdf = await exportPaperPdf(controller, paperId, "final");
    expect(pdf.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    await expect(exportPaperPdf(setter, paperId, "final")).rejects.toThrow(/final papers/);
  });
});

describe("business rules & access control", () => {
  it("blocks self-approval by the setter", async () => {
    // BCS302 (awaiting approval) was set by Dr. Sanjay Iyer, who is not an approver: grant him approval rights temporarily
    const paper = await paperByCode("BCS302-NOV2026-A");
    const hod = await as("hod.cs");
    hod.grants.set("paper.approve", null);
    await expect(transitionPaper(hod, paper.id, "approve")).rejects.toThrow(/own papers/);
  });

  it("prevents moderation by anyone but the appointed moderator", async () => {
    const paper = await paperByCode("BCS303-NOV2026-A");
    await expect(transitionPaper(await as("moderator2"), paper.id, "start_moderation")).rejects.toThrow();
  });

  it("hides papers from other departments (no IDOR)", async () => {
    const paper = await paperByCode("BCS302-NOV2026-A");
    await expect(snapshotOf(paper.id).then(async () => (await import("@/server/auth/access")).loadPaperFor(await as("hod.commerce"), paper.id))).rejects.toThrow(/not found/);
  });

  it("refuses invalid state transitions", async () => {
    const paper = await paperByCode("BCM301-NOV2026-A"); // under scrutiny
    await expect(transitionPaper(await as("approver"), paper.id, "approve")).rejects.toThrow(/not available/);
  });

  it("keeps an intact audit hash chain after all of the above", async () => {
    const r = await verifyAuditChain();
    expect(r.brokenAt).toBeNull();
    expect(r.checked).toBeGreaterThan(20);
  });
});
