/**
 * Question-paper workflow state machine.
 *
 * DRAFT → SUBMITTED → UNDER_MODERATION → (REVISION_REQUIRED → RESUBMITTED → UNDER_MODERATION)*
 *       → UNDER_SCRUTINY → AWAITING_APPROVAL → APPROVED → LOCKED → RELEASED → ARCHIVED
 *
 * Pure module: no I/O. The server layer combines it with permission + assignment checks
 * and persists every transition to PaperTransition and the audit log.
 */
import type { PaperStatus } from "@/generated/prisma/enums";
import type { PermissionKey } from "@/lib/domain/permissions";

export type PaperAction =
  | "submit"
  | "resubmit"
  | "start_moderation"
  | "moderation_request_changes"
  | "moderation_approve"
  | "moderation_reject"
  | "scrutiny_pass"
  | "scrutiny_return"
  | "approve"
  | "approval_return"
  | "approval_reject"
  | "lock"
  | "release"
  | "archive"
  | "reopen";

/** Who, relative to the paper, may perform the action (in addition to holding the permission). */
export type ActorRelation = "owner" | "moderator" | "scrutinizer" | "approver" | "authority";

export interface TransitionDef {
  action: PaperAction;
  label: string;
  from: readonly PaperStatus[];
  to: PaperStatus;
  permission: PermissionKey;
  actor: ActorRelation;
  requiresNote?: boolean;
  /** create an immutable version snapshot when this transition happens */
  snapshot?: "minor" | "major-final";
}

export const TRANSITIONS: readonly TransitionDef[] = [
  { action: "submit", label: "Submit paper", from: ["DRAFT"], to: "SUBMITTED", permission: "paper.submit", actor: "owner", snapshot: "minor" },
  { action: "resubmit", label: "Resubmit paper", from: ["REVISION_REQUIRED"], to: "RESUBMITTED", permission: "paper.submit", actor: "owner", snapshot: "minor" },
  { action: "start_moderation", label: "Start moderation", from: ["SUBMITTED", "RESUBMITTED"], to: "UNDER_MODERATION", permission: "moderation.perform", actor: "moderator" },
  { action: "moderation_request_changes", label: "Request modification", from: ["UNDER_MODERATION"], to: "REVISION_REQUIRED", permission: "moderation.perform", actor: "moderator", requiresNote: true, snapshot: "minor" },
  { action: "moderation_approve", label: "Approve moderation", from: ["UNDER_MODERATION"], to: "UNDER_SCRUTINY", permission: "moderation.perform", actor: "moderator", snapshot: "minor" },
  { action: "moderation_reject", label: "Reject paper", from: ["UNDER_MODERATION"], to: "REJECTED", permission: "moderation.perform", actor: "moderator", requiresNote: true },
  { action: "scrutiny_pass", label: "Pass scrutiny", from: ["UNDER_SCRUTINY"], to: "AWAITING_APPROVAL", permission: "scrutiny.perform", actor: "scrutinizer" },
  { action: "scrutiny_return", label: "Return for correction", from: ["UNDER_SCRUTINY"], to: "REVISION_REQUIRED", permission: "scrutiny.perform", actor: "scrutinizer", requiresNote: true },
  { action: "approve", label: "Approve", from: ["AWAITING_APPROVAL"], to: "APPROVED", permission: "paper.approve", actor: "approver" },
  { action: "approval_return", label: "Return for revision", from: ["AWAITING_APPROVAL"], to: "REVISION_REQUIRED", permission: "paper.approve", actor: "approver", requiresNote: true },
  { action: "approval_reject", label: "Reject", from: ["AWAITING_APPROVAL"], to: "REJECTED", permission: "paper.approve", actor: "approver", requiresNote: true },
  { action: "lock", label: "Lock paper", from: ["APPROVED"], to: "LOCKED", permission: "paper.lock", actor: "authority", snapshot: "major-final" },
  { action: "release", label: "Release to printing", from: ["LOCKED"], to: "RELEASED", permission: "paper.release", actor: "authority" },
  { action: "archive", label: "Archive", from: ["LOCKED", "RELEASED", "REJECTED"], to: "ARCHIVED", permission: "paper.archive", actor: "authority" },
  { action: "reopen", label: "Reopen for revision", from: ["APPROVED", "REJECTED"], to: "REVISION_REQUIRED", permission: "paper.override", actor: "authority", requiresNote: true },
] as const;

export function getTransition(action: PaperAction): TransitionDef {
  const t = TRANSITIONS.find((x) => x.action === action);
  if (!t) throw new Error(`Unknown paper action: ${action}`);
  return t;
}

export function canTransition(from: PaperStatus, action: PaperAction): boolean {
  return getTransition(action).from.includes(from);
}

export function nextStatus(from: PaperStatus, action: PaperAction): PaperStatus {
  const t = getTransition(action);
  if (!t.from.includes(from)) {
    throw new WorkflowError(`“${t.label}” is not allowed while the paper is ${from.replaceAll("_", " ").toLowerCase()}.`);
  }
  return t.to;
}

export function transitionsFrom(status: PaperStatus): TransitionDef[] {
  return TRANSITIONS.filter((t) => t.from.includes(status));
}

export class WorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowError";
  }
}

/** Statuses in which the setter may edit paper content. */
export const SETTER_EDITABLE: readonly PaperStatus[] = ["DRAFT", "REVISION_REQUIRED"];
/** Statuses in which a moderator may replace questions. */
export const MODERATOR_EDITABLE: readonly PaperStatus[] = ["UNDER_MODERATION"];
/** Statuses after which content is frozen (also enforced by a database trigger). */
export const FROZEN: readonly PaperStatus[] = ["APPROVED", "LOCKED", "RELEASED", "ARCHIVED"];
/** Statuses in which a final PDF may be produced. */
export const FINAL_EXPORTABLE: readonly PaperStatus[] = ["LOCKED", "RELEASED", "ARCHIVED"];

/** Ordered pipeline used for progress displays. */
export const PIPELINE: readonly { key: string; label: string; statuses: readonly PaperStatus[] }[] = [
  { key: "setting", label: "Setting", statuses: ["DRAFT", "REVISION_REQUIRED"] },
  { key: "submitted", label: "Submitted", statuses: ["SUBMITTED", "RESUBMITTED"] },
  { key: "moderation", label: "Moderation", statuses: ["UNDER_MODERATION"] },
  { key: "scrutiny", label: "Scrutiny", statuses: ["UNDER_SCRUTINY"] },
  { key: "approval", label: "Approval", statuses: ["AWAITING_APPROVAL"] },
  { key: "approved", label: "Approved", statuses: ["APPROVED"] },
  { key: "locked", label: "Locked", statuses: ["LOCKED", "RELEASED", "ARCHIVED"] },
];

export function pipelineIndex(status: PaperStatus): number {
  return PIPELINE.findIndex((p) => p.statuses.includes(status));
}

export function nextVersion(
  current: { major: number; minor: number },
  kind: "minor" | "major-final",
): { major: number; minor: number; label: string; isFinal: boolean } {
  if (kind === "major-final") {
    const major = Math.max(current.major, 0) + 1;
    return { major, minor: 0, label: `${major}.0 FINAL`, isFinal: true };
  }
  if (current.major === 0) return { major: 1, minor: 0, label: "1.0", isFinal: false };
  const minor = current.minor + 1;
  return { major: current.major, minor, label: `${current.major}.${minor}`, isFinal: false };
}
