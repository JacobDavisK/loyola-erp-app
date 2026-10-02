import type {
  AssignmentStatus,
  BloomLevel,
  CourseType,
  Difficulty,
  ExamType,
  ModerationStatus,
  PaperStatus,
  QuestionStatus,
  QuestionType,
  ScrutinyStatus,
  SessionStatus,
} from "@/generated/prisma/enums";

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  MCQ: "Multiple choice",
  TRUE_FALSE: "True / False",
  FILL_BLANK: "Fill in the blank",
  VERY_SHORT: "Very short answer",
  SHORT: "Short answer",
  DESCRIPTIVE: "Descriptive",
  ESSAY: "Essay",
  CASE_STUDY: "Case study",
  PROBLEM: "Problem solving",
  NUMERICAL: "Numerical",
  ASSERTION_REASON: "Assertion / Reason",
  MATCH: "Match the following",
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  EASY: "Easy",
  MODERATE: "Moderate",
  HARD: "Hard",
};

export const BLOOM_LABEL: Record<BloomLevel, string> = {
  REMEMBER: "Remember",
  UNDERSTAND: "Understand",
  APPLY: "Apply",
  ANALYZE: "Analyze",
  EVALUATE: "Evaluate",
  CREATE: "Create",
};

/** K-levels as used in outcome-based education (K1 … K6). */
export const BLOOM_K: Record<BloomLevel, string> = {
  REMEMBER: "K1",
  UNDERSTAND: "K2",
  APPLY: "K3",
  ANALYZE: "K4",
  EVALUATE: "K5",
  CREATE: "K6",
};

export const EXAM_TYPE_LABEL: Record<ExamType, string> = {
  REGULAR: "Regular",
  SUPPLEMENTARY: "Supplementary",
  REVALUATION: "Revaluation",
  IMPROVEMENT: "Improvement",
  BACKLOG: "Backlog",
  SPECIAL: "Special examination",
};

export const COURSE_TYPE_LABEL: Record<CourseType, string> = {
  CORE: "Core",
  ELECTIVE: "Elective",
  ALLIED: "Allied",
  SKILL_ENHANCEMENT: "Skill enhancement",
  ABILITY_ENHANCEMENT: "Ability enhancement",
  PROJECT: "Project",
};

export const QUESTION_STATUS_LABEL: Record<QuestionStatus, string> = {
  DRAFT: "Draft",
  PENDING_REVIEW: "Pending review",
  ACTIVE: "Active",
  RETIRED: "Retired",
};

export type Tone = "neutral" | "info" | "progress" | "warning" | "success" | "danger" | "locked";

export interface StatusMeta {
  label: string;
  tone: Tone;
  /** lucide icon name, rendered by <StatusBadge>; status never relies on colour alone */
  icon: string;
}

export const PAPER_STATUS: Record<PaperStatus, StatusMeta> = {
  DRAFT: { label: "Draft", tone: "neutral", icon: "pencil" },
  SUBMITTED: { label: "Submitted", tone: "info", icon: "send" },
  UNDER_MODERATION: { label: "Under moderation", tone: "progress", icon: "scan-search" },
  REVISION_REQUIRED: { label: "Revision required", tone: "warning", icon: "undo-2" },
  RESUBMITTED: { label: "Resubmitted", tone: "info", icon: "send" },
  UNDER_SCRUTINY: { label: "Under scrutiny", tone: "progress", icon: "list-checks" },
  AWAITING_APPROVAL: { label: "Awaiting approval", tone: "progress", icon: "stamp" },
  APPROVED: { label: "Approved", tone: "success", icon: "badge-check" },
  LOCKED: { label: "Locked", tone: "locked", icon: "lock" },
  RELEASED: { label: "Released", tone: "success", icon: "package-check" },
  ARCHIVED: { label: "Archived", tone: "neutral", icon: "archive" },
  REJECTED: { label: "Rejected", tone: "danger", icon: "circle-x" },
};

export const SESSION_STATUS: Record<SessionStatus, StatusMeta> = {
  PLANNING: { label: "Planning", tone: "neutral", icon: "compass" },
  OPEN: { label: "Open", tone: "info", icon: "circle-dot" },
  PAPER_SETTING: { label: "Paper setting", tone: "progress", icon: "pencil-ruler" },
  MODERATION: { label: "Moderation", tone: "progress", icon: "scan-search" },
  SCRUTINY: { label: "Scrutiny", tone: "progress", icon: "list-checks" },
  APPROVAL: { label: "Approval", tone: "progress", icon: "stamp" },
  LOCKED: { label: "Locked", tone: "locked", icon: "lock" },
  PUBLISHED: { label: "Published", tone: "success", icon: "megaphone" },
  ARCHIVED: { label: "Archived", tone: "neutral", icon: "archive" },
};

export const ASSIGNMENT_STATUS: Record<AssignmentStatus, StatusMeta> = {
  ASSIGNED: { label: "Assigned", tone: "info", icon: "inbox" },
  ACCEPTED: { label: "Accepted", tone: "info", icon: "check" },
  DECLINED: { label: "Declined", tone: "danger", icon: "circle-x" },
  IN_PROGRESS: { label: "In progress", tone: "progress", icon: "pencil" },
  SUBMITTED: { label: "Submitted", tone: "success", icon: "send" },
  RETURNED: { label: "Returned", tone: "warning", icon: "undo-2" },
  RESUBMITTED: { label: "Resubmitted", tone: "info", icon: "send" },
  APPROVED: { label: "Approved", tone: "success", icon: "badge-check" },
  CANCELLED: { label: "Cancelled", tone: "neutral", icon: "ban" },
};

export const MODERATION_STATUS: Record<ModerationStatus, StatusMeta> = {
  PENDING: { label: "Pending", tone: "info", icon: "inbox" },
  IN_REVIEW: { label: "In review", tone: "progress", icon: "scan-search" },
  CHANGES_REQUESTED: { label: "Returned", tone: "warning", icon: "undo-2" },
  APPROVED: { label: "Approved", tone: "success", icon: "badge-check" },
  REJECTED: { label: "Rejected", tone: "danger", icon: "circle-x" },
};

export const SCRUTINY_STATUS: Record<ScrutinyStatus, StatusMeta> = {
  PENDING: { label: "Pending", tone: "info", icon: "inbox" },
  IN_PROGRESS: { label: "In progress", tone: "progress", icon: "list-checks" },
  PASSED: { label: "Passed", tone: "success", icon: "badge-check" },
  RETURNED: { label: "Returned", tone: "warning", icon: "undo-2" },
};

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} ${h === 1 ? "Hour" : "Hours"}`;
  return `${m} min`;
}

export const WORKFLOW_STATUS: Record<"IN_PROGRESS" | "APPROVED" | "REJECTED" | "RETURNED" | "CANCELLED", StatusMeta> = {
  IN_PROGRESS: { label: "In approval", tone: "progress", icon: "scan-search" },
  APPROVED: { label: "Approved", tone: "success", icon: "badge-check" },
  REJECTED: { label: "Rejected", tone: "danger", icon: "circle-x" },
  RETURNED: { label: "Returned for correction", tone: "warning", icon: "undo-2" },
  CANCELLED: { label: "Withdrawn", tone: "neutral", icon: "ban" },
};

export const TASK_STATUS: Record<"PENDING" | "APPROVED" | "REJECTED" | "RETURNED" | "SKIPPED" | "CANCELLED", StatusMeta> = {
  PENDING: { label: "Pending", tone: "info", icon: "inbox" },
  APPROVED: { label: "Approved", tone: "success", icon: "check" },
  REJECTED: { label: "Rejected", tone: "danger", icon: "circle-x" },
  RETURNED: { label: "Returned", tone: "warning", icon: "undo-2" },
  SKIPPED: { label: "Not needed", tone: "neutral", icon: "circle-dot" },
  CANCELLED: { label: "Cancelled", tone: "neutral", icon: "ban" },
};

export const JOB_STATUS: Record<"QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED", StatusMeta> = {
  QUEUED: { label: "Queued", tone: "info", icon: "inbox" },
  RUNNING: { label: "Running", tone: "progress", icon: "circle-dot" },
  SUCCEEDED: { label: "Succeeded", tone: "success", icon: "check" },
  FAILED: { label: "Failed", tone: "danger", icon: "circle-x" },
  CANCELLED: { label: "Cancelled", tone: "neutral", icon: "ban" },
};

export const STUDENT_STATUS: Record<"ACTIVE" | "ON_LEAVE" | "SUSPENDED" | "WITHDRAWN" | "DISCONTINUED" | "GRADUATED" | "EXITED", StatusMeta> = {
  ACTIVE: { label: "Active", tone: "success", icon: "circle-dot" },
  ON_LEAVE: { label: "On leave", tone: "warning", icon: "undo-2" },
  SUSPENDED: { label: "Suspended", tone: "danger", icon: "ban" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral", icon: "archive" },
  DISCONTINUED: { label: "Discontinued", tone: "neutral", icon: "circle-x" },
  GRADUATED: { label: "Graduated", tone: "locked", icon: "badge-check" },
  EXITED: { label: "Exited with award", tone: "neutral", icon: "stamp" },
};

export const OFFERING_STATUS: Record<"PLANNED" | "OPEN" | "CLOSED" | "CANCELLED" | "COMPLETED", StatusMeta> = {
  PLANNED: { label: "Planned", tone: "neutral", icon: "compass" },
  OPEN: { label: "Open for registration", tone: "info", icon: "circle-dot" },
  CLOSED: { label: "Registration closed", tone: "progress", icon: "lock" },
  CANCELLED: { label: "Cancelled", tone: "danger", icon: "ban" },
  COMPLETED: { label: "Completed", tone: "success", icon: "check" },
};

export const TERM_STATUS: Record<"PLANNED" | "REGISTRATION" | "IN_PROGRESS" | "COMPLETED", StatusMeta> = {
  PLANNED: { label: "Planned", tone: "neutral", icon: "compass" },
  REGISTRATION: { label: "Registration", tone: "info", icon: "inbox" },
  IN_PROGRESS: { label: "In progress", tone: "progress", icon: "circle-dot" },
  COMPLETED: { label: "Completed", tone: "success", icon: "check" },
};

export const REGISTRATION_STATUS: Record<"REGISTERED" | "DROPPED" | "WITHDRAWN" | "COMPLETED", StatusMeta> = {
  REGISTERED: { label: "Registered", tone: "info", icon: "check" },
  DROPPED: { label: "Dropped", tone: "neutral", icon: "undo-2" },
  WITHDRAWN: { label: "Withdrawn", tone: "warning", icon: "archive" },
  COMPLETED: { label: "Completed", tone: "success", icon: "badge-check" },
};

export const ATTENDANCE_MARK_LABEL: Record<"PRESENT" | "ABSENT" | "LATE" | "EXCUSED" | "ON_DUTY" | "MEDICAL", { label: string; short: string }> = {
  PRESENT: { label: "Present", short: "P" },
  ABSENT: { label: "Absent", short: "A" },
  LATE: { label: "Late", short: "L" },
  EXCUSED: { label: "Excused", short: "E" },
  ON_DUTY: { label: "On duty", short: "OD" },
  MEDICAL: { label: "Medical leave", short: "ML" },
};

export const GUARDIAN_RELATION_LABEL: Record<"FATHER" | "MOTHER" | "GUARDIAN" | "SPOUSE" | "SIBLING" | "OTHER", string> = {
  FATHER: "Father", MOTHER: "Mother", GUARDIAN: "Guardian", SPOUSE: "Spouse", SIBLING: "Sibling", OTHER: "Other",
};

export const EXAM_REG_STATUS: Record<"ELIGIBLE" | "NOT_ELIGIBLE" | "CONDONATION_PENDING" | "REGISTERED" | "CANCELLED", StatusMeta> = {
  ELIGIBLE: { label: "Eligible", tone: "info", icon: "check" },
  NOT_ELIGIBLE: { label: "Not eligible", tone: "danger", icon: "ban" },
  CONDONATION_PENDING: { label: "Condonation needed", tone: "warning", icon: "undo-2" },
  REGISTERED: { label: "Hall ticket issued", tone: "success", icon: "badge-check" },
  CANCELLED: { label: "Cancelled", tone: "neutral", icon: "circle-x" },
};

export const SHEET_STATUS: Record<"DRAFT" | "SUBMITTED" | "VERIFIED" | "APPROVED" | "RETURNED", StatusMeta> = {
  DRAFT: { label: "Draft", tone: "neutral", icon: "pencil" },
  SUBMITTED: { label: "In approval", tone: "progress", icon: "send" },
  VERIFIED: { label: "Verified", tone: "info", icon: "check" },
  APPROVED: { label: "Approved", tone: "success", icon: "badge-check" },
  RETURNED: { label: "Returned", tone: "warning", icon: "undo-2" },
};

export const SCRIPT_STATUS: Record<"PENDING" | "IN_VALUATION" | "VALUED" | "THIRD_VALUATION" | "FINAL", StatusMeta> = {
  PENDING: { label: "Not assigned", tone: "neutral", icon: "inbox" },
  IN_VALUATION: { label: "In valuation", tone: "progress", icon: "pencil" },
  VALUED: { label: "Awaiting second valuation", tone: "info", icon: "check" },
  THIRD_VALUATION: { label: "Third valuation needed", tone: "warning", icon: "scan-search" },
  FINAL: { label: "Final", tone: "success", icon: "lock" },
};

export const RUN_STATUS: Record<"DRAFT" | "COMPUTED" | "IN_APPROVAL" | "APPROVED" | "PUBLISHED", StatusMeta> = {
  DRAFT: { label: "Not computed", tone: "neutral", icon: "pencil" },
  COMPUTED: { label: "Computed", tone: "info", icon: "list-checks" },
  IN_APPROVAL: { label: "In approval", tone: "progress", icon: "stamp" },
  APPROVED: { label: "Approved", tone: "success", icon: "check" },
  PUBLISHED: { label: "Published", tone: "locked", icon: "megaphone" },
};

export const COURSE_RESULT_STATUS: Record<"PASS" | "FAIL" | "ABSENT" | "WITHHELD" | "INCOMPLETE", StatusMeta> = {
  PASS: { label: "Pass", tone: "success", icon: "check" },
  FAIL: { label: "Fail", tone: "danger", icon: "circle-x" },
  ABSENT: { label: "Absent", tone: "warning", icon: "ban" },
  WITHHELD: { label: "Withheld", tone: "locked", icon: "lock" },
  INCOMPLETE: { label: "Incomplete", tone: "neutral", icon: "circle-dot" },
};

export const REVAL_STATUS: Record<"REQUESTED" | "FEE_PENDING" | "IN_PROGRESS" | "COMPLETED" | "REJECTED" | "CANCELLED", StatusMeta> = {
  REQUESTED: { label: "Ready to start", tone: "info", icon: "inbox" },
  FEE_PENDING: { label: "Fee pending", tone: "warning", icon: "circle-dot" },
  IN_PROGRESS: { label: "In progress", tone: "progress", icon: "scan-search" },
  COMPLETED: { label: "Completed", tone: "success", icon: "badge-check" },
  REJECTED: { label: "Rejected", tone: "danger", icon: "circle-x" },
  CANCELLED: { label: "Cancelled", tone: "neutral", icon: "ban" },
};

export const CREDENTIAL_STATUS: Record<"ISSUED" | "REVOKED" | "SUPERSEDED", StatusMeta> = {
  ISSUED: { label: "Valid", tone: "success", icon: "badge-check" },
  REVOKED: { label: "Revoked", tone: "danger", icon: "ban" },
  SUPERSEDED: { label: "Superseded", tone: "neutral", icon: "archive" },
};

export const INVOICE_STATUS: Record<"DRAFT" | "ISSUED" | "PARTIALLY_PAID" | "PAID" | "CANCELLED", StatusMeta> = {
  DRAFT: { label: "Draft", tone: "neutral", icon: "pencil" },
  ISSUED: { label: "Unpaid", tone: "warning", icon: "circle-dot" },
  PARTIALLY_PAID: { label: "Part paid", tone: "info", icon: "circle-dot" },
  PAID: { label: "Paid", tone: "success", icon: "check" },
  CANCELLED: { label: "Cancelled", tone: "neutral", icon: "ban" },
};

export const PAYMENT_STATUS: Record<"PENDING" | "SUCCEEDED" | "FAILED" | "REVERSED", StatusMeta> = {
  PENDING: { label: "Pending", tone: "info", icon: "inbox" },
  SUCCEEDED: { label: "Received", tone: "success", icon: "check" },
  FAILED: { label: "Failed", tone: "danger", icon: "circle-x" },
  REVERSED: { label: "Reversed", tone: "danger", icon: "undo-2" },
};

export const PAYMENT_METHOD_LABEL: Record<"CASH" | "CHEQUE" | "DEMAND_DRAFT" | "BANK_TRANSFER" | "CARD_POS" | "ONLINE", string> = {
  CASH: "Cash", CHEQUE: "Cheque", DEMAND_DRAFT: "Demand draft", BANK_TRANSFER: "Bank transfer", CARD_POS: "Card (POS)", ONLINE: "Online",
};

// ───────────────────────── Human resources ─────────────────────────

export const EMPLOYEE_STATUS: Record<"ACTIVE" | "ON_LEAVE" | "SUSPENDED" | "RESIGNED" | "RETIRED" | "TERMINATED", StatusMeta> = {
  ACTIVE: { label: "Active", tone: "success", icon: "check" },
  ON_LEAVE: { label: "On long leave", tone: "info", icon: "circle-dot" },
  SUSPENDED: { label: "Suspended", tone: "danger", icon: "ban" },
  RESIGNED: { label: "Resigned", tone: "neutral", icon: "archive" },
  RETIRED: { label: "Retired", tone: "neutral", icon: "archive" },
  TERMINATED: { label: "Terminated", tone: "danger", icon: "circle-x" },
};

export const LEAVE_STATUS: Record<"PENDING" | "APPROVED" | "REJECTED" | "RETURNED" | "CANCELLED", StatusMeta> = {
  PENDING: { label: "Awaiting approval", tone: "warning", icon: "circle-dot" },
  APPROVED: { label: "Approved", tone: "success", icon: "check" },
  REJECTED: { label: "Rejected", tone: "danger", icon: "circle-x" },
  RETURNED: { label: "Returned", tone: "warning", icon: "undo-2" },
  CANCELLED: { label: "Cancelled", tone: "neutral", icon: "ban" },
};

export const PAYROLL_STATUS: Record<"DRAFT" | "COMPUTED" | "IN_APPROVAL" | "APPROVED" | "PAID", StatusMeta> = {
  DRAFT: { label: "Draft", tone: "neutral", icon: "pencil" },
  COMPUTED: { label: "Computed", tone: "info", icon: "list-checks" },
  IN_APPROVAL: { label: "In approval", tone: "progress", icon: "send" },
  APPROVED: { label: "Approved", tone: "success", icon: "stamp" },
  PAID: { label: "Paid", tone: "locked", icon: "badge-check" },
};

export const STAFF_ATTENDANCE_LABEL: Record<"PRESENT" | "ABSENT" | "HALF_DAY" | "ON_LEAVE" | "ON_DUTY" | "HOLIDAY", { label: string; short: string }> = {
  PRESENT: { label: "Present", short: "P" },
  ABSENT: { label: "Absent", short: "A" },
  HALF_DAY: { label: "Half day", short: "½" },
  ON_LEAVE: { label: "On leave", short: "L" },
  ON_DUTY: { label: "On duty", short: "OD" },
  HOLIDAY: { label: "Holiday", short: "H" },
};

export const EMPLOYMENT_TYPE_LABEL: Record<"PERMANENT" | "PROBATION" | "CONTRACT" | "VISITING" | "PART_TIME", string> = {
  PERMANENT: "Permanent", PROBATION: "On probation", CONTRACT: "Contract", VISITING: "Visiting", PART_TIME: "Part-time",
};
