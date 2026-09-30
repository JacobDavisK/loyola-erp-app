import "server-only";
import katex from "katex";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { PaperStatus } from "@/generated/prisma/enums";
import { validateAgainstBlueprint } from "@/lib/domain/blueprint";
import { analysePool, generatePaper, type Candidate } from "@/lib/domain/generator";
import type { BlueprintSpec, PaperSnapshot } from "@/lib/domain/paper-types";
import { runScrutiny, scrutinyReady } from "@/lib/domain/scrutiny";
import { compareQuestions, findInternalDuplicates } from "@/lib/domain/similarity";
import { buildSnapshot, PAPER_CONTENT_INCLUDE } from "@/lib/domain/snapshot";
import { getTransition, nextVersion, type PaperAction, SETTER_EDITABLE } from "@/lib/domain/workflow";
import { collectAssets } from "@/lib/content/parse";
import { loadPaperFor, questionWhere } from "@/server/auth/access";
import { type AuthContext, can } from "@/server/auth/current";
import { db, type Tx } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { canonicalJson, sha256 } from "@/server/security/crypto";
import { audit } from "@/server/services/audit";
import { getInstitution, usersWithPermission } from "@/server/services/directory";
import { notify } from "@/server/services/notifications";
import { getSetting } from "@/server/services/settings";

// ───────────────────────── Loading ─────────────────────────

export async function loadPaperContent(paperId: string, tx?: Tx) {
  const client = tx ?? db;
  const paper = await client.questionPaper.findUnique({ where: { id: paperId }, include: PAPER_CONTENT_INCLUDE });
  if (!paper) throw notFound("Question paper");
  return paper;
}

export async function snapshotOf(paperId: string, tx?: Tx): Promise<PaperSnapshot> {
  const [paper, inst] = await Promise.all([loadPaperContent(paperId, tx), getInstitution()]);
  return buildSnapshot(paper, inst);
}

export async function blueprintSpec(blueprintId: string | null | undefined): Promise<BlueprintSpec | null> {
  if (!blueprintId) return null;
  const bp = await db.blueprint.findUnique({
    where: { id: blueprintId },
    include: { sections: { orderBy: { order: "asc" } }, rules: true },
  });
  if (!bp) return null;
  return {
    totalMarks: bp.totalMarks,
    durationMinutes: bp.durationMinutes,
    sections: bp.sections.map((s) => ({
      label: s.label,
      title: s.title,
      questionCount: s.questionCount,
      attemptCount: s.attemptCount,
      marksPerQuestion: s.marksPerQuestion,
      questionTypes: s.questionTypes,
      units: s.units,
      instructions: s.instructions,
    })),
    rules: bp.rules.map((r) => ({ dimension: r.dimension, key: r.key, targetPercent: r.targetPercent, tolerance: r.tolerance })),
  };
}

export function validateMath(tex: string): string | null {
  try {
    katex.renderToString(tex, { throwOnError: true, strict: "ignore", trust: false });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message.replace(/^KaTeX parse error: /, "").slice(0, 80) : "Invalid expression";
  }
}

export async function computeScrutiny(paperId: string) {
  const paper = await db.questionPaper.findUniqueOrThrow({
    where: { id: paperId },
    include: { examination: { include: { course: true } }, setter: { select: { name: true } } },
  });
  const [snapshot, bp, inst, watermarks] = await Promise.all([
    snapshotOf(paperId),
    blueprintSpec(paper.blueprintId ?? paper.examination.blueprintId),
    getInstitution(),
    db.watermark.count({ where: { isActive: true, appliesTo: { has: "FINAL_PDF" } } }),
  ]);
  const assetIds = snapshot.sections.flatMap((s) => s.items.flatMap((i) => collectAssets(i.body)));
  const known = new Set((await db.fileAsset.findMany({ where: { id: { in: assetIds }, deletedAt: null }, select: { id: true } })).map((a) => a.id));
  const surname = paper.setter.name.replace(/^(Dr\.|Prof\.|Mr\.|Ms\.|Mrs\.)\s*/i, "").split(" ").pop() ?? paper.setter.name;
  const checks = runScrutiny({
    snapshot,
    blueprint: bp,
    expected: {
      courseCode: paper.examination.course.code,
      courseTitle: paper.examination.course.title,
      durationMinutes: paper.examination.durationMinutes,
      maxMarks: paper.examination.maxMarks,
    },
    hasBranding: !!inst.name && !!inst.logoAssetId,
    hasActiveWatermark: watermarks > 0,
    setterName: surname.length >= 4 ? surname : paper.setter.name,
    knownAssetIds: known,
    validateMath,
  });
  return { checks, ready: scrutinyReady(checks), snapshot };
}

// ───────────────────────── Editing ─────────────────────────

export const paperStructureSchema = z.object({
  revision: z.number().int().min(0),
  instructions: z.string().max(4000).nullable(),
  sections: z
    .array(
      z.object({
        id: z.string().optional(),
        label: z.string().trim().min(1).max(8),
        title: z.string().trim().min(1).max(200),
        instructions: z.string().max(2000).nullable(),
        attemptCount: z.number().int().min(1).max(100).nullable(),
        marksPerQuestion: z.number().int().min(1).max(100).nullable(),
        parentLabel: z.string().max(8).nullable().optional(),
        items: z.array(z.object({ questionId: z.string().min(1), marks: z.number().int().min(1).max(100) })).max(100),
      }),
    )
    .min(1)
    .max(20),
});
export type PaperStructureInput = z.infer<typeof paperStructureSchema>;

/**
 * Save the builder state. Items are matched by question id so moderation comments and version
 * references survive reordering. Optimistic concurrency via `revision`.
 */
export async function savePaperStructure(ctx: AuthContext, paperId: string, raw: unknown) {
  const input = paperStructureSchema.parse(raw);
  const { paper, caps } = await loadPaperFor(ctx, paperId);
  if (!caps.editContent) {
    if (!SETTER_EDITABLE.includes(paper.status)) throw forbidden(`This paper is ${paper.status.replaceAll("_", " ").toLowerCase()} and cannot be edited.`);
    throw forbidden("Only the assigned setter can edit this paper.");
  }
  if (paper.revision !== input.revision) {
    throw conflict("Another authorised user modified this paper.", { currentRevision: paper.revision });
  }
  const labels = input.sections.map((s) => s.label.toUpperCase());
  if (new Set(labels).size !== labels.length) throw invalid("Section labels must be unique.");
  const allIds = input.sections.flatMap((s) => s.items.map((i) => i.questionId));
  if (new Set(allIds).size !== allIds.length) throw invalid("A question can appear only once in a paper.");

  const exam = await db.examination.findUniqueOrThrow({ where: { id: paper.examinationId }, select: { courseId: true } });
  const questions = await db.question.findMany({
    where: { AND: [questionWhere(ctx), { id: { in: allIds }, courseId: exam.courseId, status: { in: ["ACTIVE", "PENDING_REVIEW"] } }] },
    include: { versions: { orderBy: { version: "desc" }, take: 1, select: { id: true } } },
  });
  if (questions.length !== allIds.length) throw invalid("Some questions are unavailable, retired or belong to a different course.");
  const latestVersion = new Map(questions.map((q) => [q.id, q.versions[0].id]));

  const before = await db.questionPaperItem.findMany({ where: { section: { paperId } }, select: { id: true, questionId: true, questionVersionId: true } });
  const beforeByQ = new Map(before.map((b) => [b.questionId, b]));

  const result = await db.$transaction(async (tx) => {
    const bumped = await tx.questionPaper.updateMany({
      where: { id: paperId, revision: input.revision },
      data: { revision: { increment: 1 }, instructions: input.instructions },
    });
    if (bumped.count !== 1) throw conflict("Another authorised user modified this paper.");

    const existing = await tx.questionPaperSection.findMany({ where: { paperId }, select: { id: true } });
    const keepIds = new Set(input.sections.map((s) => s.id).filter(Boolean) as string[]);
    const validIds = new Set(existing.map((s) => s.id));
    const sectionIdByLabel = new Map<string, string>();

    // Upsert sections
    for (const [order, s] of input.sections.entries()) {
      const data = { order, label: s.label.toUpperCase(), title: s.title, instructions: s.instructions, attemptCount: s.attemptCount, marksPerQuestion: s.marksPerQuestion };
      const id = s.id && validIds.has(s.id) ? (await tx.questionPaperSection.update({ where: { id: s.id }, data })).id : (await tx.questionPaperSection.create({ data: { ...data, paperId } })).id;
      sectionIdByLabel.set(data.label, id);
    }
    for (const s of input.sections) {
      const id = sectionIdByLabel.get(s.label.toUpperCase())!;
      const parentId = s.parentLabel ? (sectionIdByLabel.get(s.parentLabel.toUpperCase()) ?? null) : null;
      if (parentId !== id) await tx.questionPaperSection.update({ where: { id }, data: { parentId } });
    }

    // Items: remove, then upsert by question id
    const removed = before.filter((b) => !allIds.includes(b.questionId));
    if (removed.length) await tx.questionPaperItem.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } });
    for (const s of input.sections) {
      const sectionId = sectionIdByLabel.get(s.label.toUpperCase())!;
      for (const [order, it] of s.items.entries()) {
        const prev = beforeByQ.get(it.questionId);
        if (prev) await tx.questionPaperItem.update({ where: { id: prev.id }, data: { sectionId, order, marks: it.marks } });
        else await tx.questionPaperItem.create({ data: { sectionId, order, questionId: it.questionId, questionVersionId: latestVersion.get(it.questionId)!, marks: it.marks } });
      }
    }
    const obsolete = existing.filter((s) => !keepIds.has(s.id) && ![...sectionIdByLabel.values()].includes(s.id));
    if (obsolete.length) await tx.questionPaperSection.deleteMany({ where: { id: { in: obsolete.map((s) => s.id) } } });

    const added = allIds.filter((id) => !beforeByQ.has(id));
    if (paper.status === "DRAFT" && paper.assignmentId) {
      await tx.setterAssignment.updateMany({ where: { id: paper.assignmentId, status: { in: ["ASSIGNED", "ACCEPTED"] } }, data: { status: "IN_PROGRESS" } });
    }
    if (added.length || removed.length) {
      await audit(
        {
          actorId: ctx.user.id,
          actorName: ctx.user.name,
          action: "paper.content.update",
          resourceType: "paper",
          resourceId: paperId,
          summary: `${added.length} question(s) added, ${removed.length} removed`,
          oldValue: { questions: before.map((b) => b.questionId) },
          newValue: { questions: allIds },
        },
        tx,
      );
    }
    return { revision: input.revision + 1, added: added.length, removed: removed.length };
  });
  return result;
}

// ───────────────────────── Versions ─────────────────────────

async function createVersion(tx: Tx, paperId: string, kind: "minor" | "major-final", status: PaperStatus, reason: string, actorId: string) {
  const paper = await tx.questionPaper.findUniqueOrThrow({ where: { id: paperId }, select: { versionMajor: true, versionMinor: true } });
  const next = nextVersion({ major: paper.versionMajor, minor: paper.versionMinor }, kind);
  const snap = buildSnapshot(await loadPaperContent(paperId, tx), await getInstitution());
  const contentHash = sha256(canonicalJson(snap));
  await tx.questionPaperVersion.create({
    data: {
      paperId,
      major: next.major,
      minor: next.minor,
      label: next.label,
      isFinal: next.isFinal,
      status,
      snapshot: snap as unknown as Prisma.InputJsonValue,
      contentHash,
      reason,
      createdById: actorId,
    },
  });
  await tx.questionPaper.update({ where: { id: paperId }, data: { versionMajor: next.major, versionMinor: next.minor } });
  return { ...next, contentHash };
}

export function currentVersionLabel(p: { versionMajor: number; versionMinor: number; status: PaperStatus }): string {
  if (p.versionMajor === 0) return "Draft";
  return `${p.versionMajor}.${p.versionMinor}${["LOCKED", "RELEASED", "ARCHIVED"].includes(p.status) ? " FINAL" : ""}`;
}

// ───────────────────────── Workflow ─────────────────────────

export interface TransitionOptions {
  note?: string;
  moderationChecklist?: Record<string, { ok: boolean; note?: string }>;
}

/**
 * The only way a paper changes state. Verifies permission, the actor's relation to the paper,
 * workflow preconditions, then atomically applies the transition with version snapshot,
 * transition log, audit entry and notifications.
 */
export async function transitionPaper(ctx: AuthContext, paperId: string, action: PaperAction, opts: TransitionOptions = {}) {
  const def = getTransition(action);
  const { paper, caps } = await loadPaperFor(ctx, paperId);
  const dept = paper.examination.course.departmentId;
  if (!def.from.includes(paper.status)) {
    throw workflowError(`“${def.label}” is not available while the paper is ${paper.status.replaceAll("_", " ").toLowerCase()}.`);
  }
  const workflow = await getSetting("workflow");
  const allowedByRelation = {
    owner: caps.isOwner && can(ctx, def.permission),
    moderator: caps.moderate,
    scrutinizer: caps.scrutinize,
    approver: can(ctx, def.permission, dept),
    authority: can(ctx, def.permission, dept),
  }[def.actor];
  if (!allowedByRelation) throw forbidden("You are not authorised to perform this step for this paper.");
  if (def.actor === "approver" && paper.setterId === ctx.user.id && !workflow.allowSelfApproval) {
    throw forbidden("Setters cannot approve their own papers.");
  }
  const note = opts.note?.trim();
  if (def.requiresNote && !note) throw invalid("Please add a remark explaining this decision.");

  // Preconditions
  const bp = await blueprintSpec(paper.blueprintId);
  if (action === "submit" || action === "resubmit") {
    const snap = await snapshotOf(paperId);
    const items = snap.sections.flatMap((s) => s.items);
    if (!items.length) throw workflowError("Add questions before submitting.");
    if (bp) {
      const report = validateAgainstBlueprint(snap.sections, bp);
      if (report.totalMarks !== bp.totalMarks) throw workflowError(`Total marks are ${report.totalMarks}; the blueprint requires ${bp.totalMarks}.`);
      const bad = report.sections.filter((s) => s.actualCount !== s.requiredCount);
      if (bad.length) throw workflowError(`Section ${bad.map((s) => `${s.label} has ${s.actualCount}/${s.requiredCount} questions`).join("; ")}.`);
    }
  }
  let scrutinyChecks: Awaited<ReturnType<typeof computeScrutiny>>["checks"] | null = null;
  if (action === "scrutiny_pass") {
    const result = await computeScrutiny(paperId);
    scrutinyChecks = result.checks;
    if (!result.ready) throw workflowError(`Scrutiny blockers remain: ${result.checks.filter((c) => !c.ok && c.severity === "blocker").map((c) => c.label).join(", ")}.`);
  }
  if (action === "approve") {
    const [mod, scr] = await Promise.all([
      db.moderation.findFirst({ where: { paperId }, orderBy: { round: "desc" } }),
      db.scrutiny.findFirst({ where: { paperId }, orderBy: { round: "desc" } }),
    ]);
    if (mod?.status !== "APPROVED" || scr?.status !== "PASSED") throw workflowError("Approval requires completed moderation and scrutiny.");
    if (workflow.requireMfaForApproval && !ctx.user.mfaEnabled) throw forbidden("Your role requires multi-factor authentication before approving papers.");
  }

  const to = def.to;
  const exam = await db.examination.findUniqueOrThrow({
    where: { id: paper.examinationId },
    include: { course: { select: { code: true, title: true } }, session: { select: { id: true, code: true, name: true } } },
  });
  const label = `${exam.course.code} — ${exam.course.title}`;
  const controllers = await usersWithPermission("assignment.manage", dept);
  const approvers = await usersWithPermission("paper.approve", dept);
  const setters = [paper.setterId, paper.assignment?.backupSetterId];

  const result = await db.$transaction(async (tx) => {
    const moved = await tx.questionPaper.updateMany({ where: { id: paperId, status: paper.status }, data: { status: to, revision: { increment: 1 } } });
    if (moved.count !== 1) throw conflict("The paper changed state while you were working. Refresh to see the latest status.");
    await tx.paperTransition.create({ data: { paperId, from: paper.status, to, action, actorId: ctx.user.id, note } });

    let version: { label: string; contentHash: string } | null = null;
    if (def.snapshot) version = await createVersion(tx, paperId, def.snapshot, to, `${def.label}${note ? ` — ${note}` : ""}`, ctx.user.id);
    const current = await tx.questionPaper.findUniqueOrThrow({ where: { id: paperId }, select: { versionMajor: true, versionMinor: true, status: true } });
    const versionLabel = currentVersionLabel(current);
    const latestModeration = () => tx.moderation.findFirst({ where: { paperId }, orderBy: { round: "desc" } });
    const latestScrutiny = () => tx.scrutiny.findFirst({ where: { paperId }, orderBy: { round: "desc" } });
    const link = `/papers/${paperId}`;

    switch (action) {
      case "submit":
      case "resubmit": {
        await tx.questionPaper.update({ where: { id: paperId }, data: { submittedAt: new Date() } });
        if (paper.assignmentId) await tx.setterAssignment.update({ where: { id: paper.assignmentId }, data: { status: action === "submit" ? "SUBMITTED" : "RESUBMITTED", submittedAt: new Date() } });
        const last = await latestModeration();
        if (paper.examination.moderatorId) {
          await tx.moderation.create({ data: { paperId, moderatorId: paper.examination.moderatorId, round: (last?.round ?? 0) + 1, status: "PENDING" } });
        }
        await notify({ userIds: [paper.examination.moderatorId], type: "moderation.required", title: `Moderation required: ${exam.course.code}`, body: `${label} (v${versionLabel}) is ready for moderation.`, link: `/moderation/${paperId}` }, tx);
        await notify({ userIds: controllers, type: "paper.submitted", title: `Paper ${exam.course.code} ${action === "submit" ? "submitted" : "resubmitted"}`, body: `${label} — ${ctx.user.name}`, link, email: false }, tx);
        break;
      }
      case "start_moderation": {
        const m = await latestModeration();
        if (m && m.status === "PENDING") await tx.moderation.update({ where: { id: m.id }, data: { status: "IN_REVIEW", startedAt: new Date(), moderatorId: ctx.user.id } });
        else await tx.moderation.create({ data: { paperId, moderatorId: ctx.user.id, round: (m?.round ?? 0) + 1, status: "IN_REVIEW", startedAt: new Date() } });
        break;
      }
      case "moderation_request_changes":
      case "moderation_approve":
      case "moderation_reject": {
        const m = await latestModeration();
        const status = action === "moderation_approve" ? "APPROVED" : action === "moderation_reject" ? "REJECTED" : "CHANGES_REQUESTED";
        if (m) {
          await tx.moderation.update({
            where: { id: m.id },
            data: { status, summary: note, completedAt: new Date(), versionLabel, checklist: opts.moderationChecklist as Prisma.InputJsonValue | undefined },
          });
        }
        if (action === "moderation_approve") {
          const s = await latestScrutiny();
          if (paper.examination.scrutinizerId) await tx.scrutiny.create({ data: { paperId, officerId: paper.examination.scrutinizerId, round: (s?.round ?? 0) + 1, status: "PENDING" } });
          await notify({ userIds: [paper.examination.scrutinizerId], type: "scrutiny.required", title: `Scrutiny required: ${exam.course.code}`, body: `${label} passed moderation.`, link: `/scrutiny/${paperId}` }, tx);
          await notify({ userIds: [...setters, ...controllers], type: "moderation.completed", title: `Moderation completed: ${exam.course.code}`, body: "Approved by the moderator and sent for scrutiny.", link, email: false }, tx);
        } else {
          if (action === "moderation_request_changes") {
            await tx.questionPaper.update({ where: { id: paperId }, data: { revisionCount: { increment: 1 } } });
            if (paper.assignmentId) await tx.setterAssignment.update({ where: { id: paper.assignmentId }, data: { status: "RETURNED" } });
          }
          await notify({ userIds: setters, type: "paper.returned", title: action === "moderation_reject" ? `Paper rejected: ${exam.course.code}` : `Revision requested: ${exam.course.code}`, body: note, link }, tx);
          await notify({ userIds: controllers, type: "moderation.completed", title: `Moderation outcome: ${exam.course.code}`, body: `${def.label}: ${note ?? ""}`, link, email: false }, tx);
        }
        break;
      }
      case "scrutiny_pass":
      case "scrutiny_return": {
        const s = await latestScrutiny();
        const data = {
          status: action === "scrutiny_pass" ? ("PASSED" as const) : ("RETURNED" as const),
          remarks: note,
          completedAt: new Date(),
          versionLabel,
          checks: (scrutinyChecks ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
          officerId: ctx.user.id,
        };
        if (s && (s.status === "PENDING" || s.status === "IN_PROGRESS")) await tx.scrutiny.update({ where: { id: s.id }, data });
        else await tx.scrutiny.create({ data: { ...data, paperId, round: (s?.round ?? 0) + 1 } });
        if (action === "scrutiny_pass") {
          await notify({ userIds: approvers, type: "approval.requested", title: `Approval requested: ${exam.course.code}`, body: `${label} passed scrutiny and awaits final approval.`, link: `/approvals/${paperId}` }, tx);
          await notify({ userIds: setters, type: "scrutiny.completed", title: `Scrutiny completed: ${exam.course.code}`, body: "Your paper passed final scrutiny.", link, email: false }, tx);
        } else {
          await tx.questionPaper.update({ where: { id: paperId }, data: { revisionCount: { increment: 1 } } });
          if (paper.assignmentId) await tx.setterAssignment.update({ where: { id: paper.assignmentId }, data: { status: "RETURNED" } });
          await notify({ userIds: setters, type: "paper.returned", title: `Correction requested: ${exam.course.code}`, body: note, link }, tx);
        }
        break;
      }
      case "approve":
      case "approval_return":
      case "approval_reject": {
        const decision = action === "approve" ? "APPROVED" : action === "approval_return" ? "RETURNED" : "REJECTED";
        await tx.approval.create({ data: { paperId, approverId: ctx.user.id, decision, remarks: note, versionLabel } });
        if (action === "approve") {
          await tx.questionPaper.update({ where: { id: paperId }, data: { approvedAt: new Date() } });
          await notify({ userIds: [...setters, ...controllers], type: "paper.approved", title: `Paper approved: ${exam.course.code}`, body: `${label} v${versionLabel} approved by ${ctx.user.name}.`, link, email: false }, tx);
        } else {
          if (action === "approval_return") {
            await tx.questionPaper.update({ where: { id: paperId }, data: { revisionCount: { increment: 1 } } });
            if (paper.assignmentId) await tx.setterAssignment.update({ where: { id: paper.assignmentId }, data: { status: "RETURNED" } });
          }
          await notify({ userIds: [...setters, ...controllers], type: "paper.returned", title: `${decision === "REJECTED" ? "Paper rejected" : "Returned for revision"}: ${exam.course.code}`, body: note, link }, tx);
        }
        break;
      }
      case "lock": {
        await tx.questionPaper.update({ where: { id: paperId }, data: { lockedAt: new Date(), lockedById: ctx.user.id, finalHash: version?.contentHash } });
        if (paper.assignmentId) await tx.setterAssignment.update({ where: { id: paper.assignmentId }, data: { status: "APPROVED" } });
        // Usage history is written once, at lock time, and never destroyed.
        const items = await tx.questionPaperItem.findMany({ where: { section: { paperId } } });
        const now = new Date();
        await tx.questionUsage.createMany({
          data: items.map((i) => ({ questionId: i.questionId, questionVersionId: i.questionVersionId, paperId, examinationId: paper.examinationId, sessionId: exam.session.id, usedAt: now })),
          skipDuplicates: true,
        });
        await tx.question.updateMany({ where: { id: { in: items.map((i) => i.questionId) } }, data: { usageCount: { increment: 1 }, lastUsedAt: now, lastUsedSessionId: exam.session.code } });
        await notify({ userIds: [...setters, ...controllers], type: "paper.locked", title: `Paper locked: ${exam.course.code}`, body: `Version ${versionLabel} is now immutable.`, link, email: false }, tx);
        break;
      }
      case "release":
        await tx.questionPaper.update({ where: { id: paperId }, data: { releasedAt: new Date() } });
        break;
      case "archive":
        await tx.questionPaper.update({ where: { id: paperId }, data: { archivedAt: new Date() } });
        break;
      case "reopen":
        if (paper.assignmentId) await tx.setterAssignment.update({ where: { id: paper.assignmentId }, data: { status: "RETURNED" } });
        await tx.questionPaper.update({ where: { id: paperId }, data: { revisionCount: { increment: 1 }, approvedAt: null } });
        await notify({ userIds: setters, type: "paper.returned", title: `Paper reopened: ${exam.course.code}`, body: note, link }, tx);
        break;
    }

    await audit(
      {
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        action: `paper.${action}`,
        resourceType: "paper",
        resourceId: paperId,
        summary: `${exam.course.code}: ${paper.status} → ${to}${note ? ` — ${note}` : ""}`,
        oldValue: { status: paper.status },
        newValue: { status: to, version: versionLabel },
      },
      tx,
    );
    return { status: to, version: versionLabel };
  });
  return result;
}

// ───────────────────────── Moderation edits & comments ─────────────────────────

export async function moderatorReplaceItem(ctx: AuthContext, paperId: string, itemId: string, questionId: string, reason: string) {
  const { paper, caps } = await loadPaperFor(ctx, paperId);
  if (!caps.moderate || paper.status !== "UNDER_MODERATION") throw forbidden("Questions can be replaced only by the moderator during moderation.");
  if (!reason.trim()) throw invalid("Give a reason for the replacement.");
  const item = await db.questionPaperItem.findFirst({ where: { id: itemId, section: { paperId } }, include: { question: true } });
  if (!item) throw notFound("Question");
  const exam = await db.examination.findUniqueOrThrow({ where: { id: paper.examinationId }, select: { courseId: true } });
  const replacement = await db.question.findFirst({
    where: { AND: [questionWhere(ctx), { id: questionId, courseId: exam.courseId, status: "ACTIVE" }] },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!replacement) throw invalid("Replacement question is unavailable.");
  if (replacement.marks !== item.marks) throw invalid(`Replacement must carry ${item.marks} marks.`);
  const inPaper = await db.questionPaperItem.count({ where: { questionId, section: { paperId } } });
  if (inPaper) throw invalid("That question is already in the paper.");
  await db.$transaction(async (tx) => {
    await tx.questionPaperItem.update({ where: { id: itemId }, data: { questionId, questionVersionId: replacement.versions[0].id } });
    await tx.questionPaper.update({ where: { id: paperId }, data: { revision: { increment: 1 } } });
    const m = await tx.moderation.findFirst({ where: { paperId }, orderBy: { round: "desc" } });
    await tx.moderationComment.create({
      data: { paperId, moderationId: m?.id, itemId, authorId: ctx.user.id, kind: "REPLACED", body: `Replaced ${item.question.code} with ${replacement.code}: ${reason}`, suggestedQuestionId: questionId },
    });
    await audit(
      { actorId: ctx.user.id, actorName: ctx.user.name, action: "moderation.replace_question", resourceType: "paper", resourceId: paperId, summary: `${item.question.code} → ${replacement.code}: ${reason}`, oldValue: { questionId: item.questionId }, newValue: { questionId } },
      tx,
    );
  });
}

export const commentSchema = z.object({
  itemId: z.string().nullable().optional(),
  kind: z.enum(["COMMENT", "ISSUE", "SUGGEST_REPLACEMENT"]),
  body: z.string().trim().min(2).max(2000),
  suggestedQuestionId: z.string().nullable().optional(),
});

export async function addPaperComment(ctx: AuthContext, paperId: string, raw: unknown) {
  const input = commentSchema.parse(raw);
  const { paper, caps } = await loadPaperFor(ctx, paperId);
  if (!(caps.moderate || caps.scrutinize || caps.approve || caps.isOwner)) throw forbidden();
  if (input.itemId) {
    const ok = await db.questionPaperItem.count({ where: { id: input.itemId, section: { paperId } } });
    if (!ok) throw notFound("Question");
  }
  const m = await db.moderation.findFirst({ where: { paperId }, orderBy: { round: "desc" } });
  const comment = await db.moderationComment.create({
    data: { paperId, moderationId: m?.id, itemId: input.itemId ?? null, authorId: ctx.user.id, kind: input.kind, body: input.body, suggestedQuestionId: input.suggestedQuestionId ?? null },
  });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "paper.comment", resourceType: "paper", resourceId: paperId, summary: `${input.kind}: ${input.body.slice(0, 120)}` });
  if (!caps.isOwner) await notify({ userIds: [paper.setterId], type: "paper.comment", title: "New review comment", body: input.body.slice(0, 140), link: `/papers/${paperId}`, email: false });
  return comment;
}

export async function resolveComment(ctx: AuthContext, commentId: string) {
  const c = await db.moderationComment.findUnique({ where: { id: commentId } });
  if (!c) throw notFound("Comment");
  const { caps } = await loadPaperFor(ctx, c.paperId);
  if (!(caps.isOwner || caps.moderate)) throw forbidden();
  await db.moderationComment.update({ where: { id: commentId }, data: { resolved: !c.resolved } });
}

// ───────────────────────── Generation & duplicates ─────────────────────────

async function recentSessionIds(currentSessionId: string, count: number): Promise<string[]> {
  if (count <= 0) return [];
  const current = await db.examinationSession.findUniqueOrThrow({ where: { id: currentSessionId }, select: { startDate: true } });
  const prev = await db.examinationSession.findMany({ where: { startDate: { lt: current.startDate } }, orderBy: { startDate: "desc" }, take: count, select: { id: true } });
  return prev.map((p) => p.id);
}

export async function candidatePool(ctx: AuthContext, paperId: string): Promise<{ pool: Candidate[]; spec: BlueprintSpec | null }> {
  const { paper } = await loadPaperFor(ctx, paperId);
  const exam = await db.examination.findUniqueOrThrow({ where: { id: paper.examinationId }, select: { courseId: true, sessionId: true } });
  const workflow = await getSetting("workflow");
  const recent = await recentSessionIds(exam.sessionId, workflow.reuseCoolOffSessions);
  const qs = await db.question.findMany({
    where: { AND: [questionWhere(ctx), { courseId: exam.courseId, status: "ACTIVE" }] },
    select: {
      id: true, code: true, plainText: true, marks: true, type: true, difficulty: true, bloom: true, usageCount: true,
      unit: { select: { number: true } }, outcome: { select: { code: true } }, topic: { select: { title: true } },
      usages: { where: { sessionId: { in: recent } }, select: { id: true }, take: 1 },
    },
    take: 5000,
  });
  const pool = qs.map((q) => ({
    id: q.id, code: q.code, text: q.plainText, marks: q.marks, type: q.type, difficulty: q.difficulty, bloom: q.bloom,
    unitNumber: q.unit.number, outcomeCode: q.outcome?.code ?? null, topic: q.topic?.title ?? null,
    usageCount: q.usageCount, recentlyUsed: q.usages.length > 0,
  }));
  return { pool, spec: await blueprintSpec(paper.blueprintId) };
}

export async function previewGeneration(ctx: AuthContext, paperId: string, opts: { sections?: string[]; seed?: number; allowRecentReuse?: boolean; keep?: Record<string, string[]> }) {
  const { caps } = await loadPaperFor(ctx, paperId);
  if (!caps.editContent || !can(ctx, "paper.generate")) throw forbidden("You cannot generate questions for this paper.");
  const { pool, spec } = await candidatePool(ctx, paperId);
  if (!spec) throw invalid("This paper has no blueprint; automatic generation needs one.");
  const workflow = await getSetting("workflow");
  const analysis = analysePool(spec, pool, !!opts.allowRecentReuse);
  const result = generatePaper(spec, pool, {
    seed: opts.seed ?? Date.now() % 100000,
    sections: opts.sections,
    keep: opts.keep,
    allowRecentReuse: opts.allowRecentReuse,
    duplicateThreshold: workflow.duplicateThreshold,
  });
  return { analysis, result };
}

export interface DuplicateFinding {
  itemQuestionId: string;
  itemCode: string;
  otherQuestionId: string;
  otherCode: string;
  otherText: string;
  similarity: number;
  kind: string;
  scope: "in-paper" | "previously-used";
  usedIn: string[];
}

/** Duplicate & reuse analysis for a paper: repeats inside the paper and similarity to previously used questions. */
export async function paperDuplicates(ctx: AuthContext, paperId: string): Promise<DuplicateFinding[]> {
  await loadPaperFor(ctx, paperId);
  const snap = await snapshotOf(paperId);
  const items = snap.sections.flatMap((s) => s.items);
  const out: DuplicateFinding[] = [];
  const workflow = await getSetting("workflow");

  for (const d of findInternalDuplicates(items.map((i) => ({ id: i.questionId, text: i.body, topic: i.topic, code: i.questionCode })), workflow.duplicateThreshold)) {
    out.push({ itemQuestionId: d.b.id, itemCode: d.b.code, otherQuestionId: d.a.id, otherCode: d.a.code, otherText: d.a.text, similarity: d.result.score, kind: d.result.kind, scope: "in-paper", usedIn: [] });
  }

  const paper = await db.questionPaper.findUniqueOrThrow({ where: { id: paperId }, select: { examination: { select: { courseId: true, sessionId: true } } } });
  const used = await db.questionUsage.findMany({
    where: { question: { courseId: paper.examination.courseId }, paperId: { not: paperId } },
    include: { question: { select: { id: true, code: true, plainText: true, topic: { select: { title: true } } } }, examination: { select: { session: { select: { name: true } } } } },
    orderBy: { usedAt: "desc" },
    take: 2000,
  });
  const usedByQ = new Map<string, { code: string; text: string; topic: string | null; sessions: Set<string> }>();
  for (const u of used) {
    const e = usedByQ.get(u.questionId) ?? { code: u.question.code, text: u.question.plainText, topic: u.question.topic?.title ?? null, sessions: new Set<string>() };
    e.sessions.add(u.examination.session.name);
    usedByQ.set(u.questionId, e);
  }
  for (const item of items) {
    for (const [qid, u] of usedByQ) {
      const r = qid === item.questionId ? { score: 1, kind: "exact" } : compareQuestions({ text: item.body, topic: item.topic }, { text: u.text, topic: u.topic });
      if (r.score >= workflow.duplicateThreshold || qid === item.questionId) {
        out.push({ itemQuestionId: item.questionId, itemCode: item.questionCode, otherQuestionId: qid, otherCode: u.code, otherText: u.text, similarity: r.score, kind: qid === item.questionId ? "previously-used" : r.kind, scope: "previously-used", usedIn: [...u.sessions] });
      }
    }
  }
  return out.sort((a, b) => b.similarity - a.similarity);
}

export async function paperForUser(ctx: AuthContext, paperId: string) {
  const { paper, caps } = await loadPaperFor(ctx, paperId);
  return { paper, caps };
}

/** Workflow actions the caller may perform right now (UI hint; the server re-checks on execution). */
export async function availableActions(ctx: AuthContext, paperId: string) {
  const { paper, caps } = await loadPaperFor(ctx, paperId);
  const dept = paper.examination.course.departmentId;
  const workflow = await getSetting("workflow");
  const { transitionsFrom } = await import("@/lib/domain/workflow");
  return transitionsFrom(paper.status).filter((t) => {
    switch (t.actor) {
      case "owner":
        return caps.isOwner && can(ctx, t.permission);
      case "moderator":
        return caps.moderate;
      case "scrutinizer":
        return caps.scrutinize;
      case "approver":
        return can(ctx, t.permission, dept) && (paper.setterId !== ctx.user.id || workflow.allowSelfApproval);
      case "authority":
        return can(ctx, t.permission, dept);
    }
  }).map((t) => ({ action: t.action, label: t.label, requiresNote: !!t.requiresNote, to: t.to }));
}
