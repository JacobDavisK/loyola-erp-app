import type { StatusMeta } from "@/lib/domain/labels";

export const TICKET_STATUS: Record<"OPEN" | "IN_PROGRESS" | "WAITING" | "RESOLVED" | "CLOSED", StatusMeta> = {
  OPEN: { label: "Open", tone: "warning", icon: "circle-dot" },
  IN_PROGRESS: { label: "In progress", tone: "progress", icon: "pencil" },
  WAITING: { label: "Waiting for requester", tone: "info", icon: "undo-2" },
  RESOLVED: { label: "Resolved", tone: "success", icon: "check" },
  CLOSED: { label: "Closed", tone: "neutral", icon: "lock" },
};

export const APPLICANT_STATUS: Record<"SUBMITTED" | "VERIFIED" | "REJECTED" | "OFFERED" | "ACCEPTED" | "DECLINED" | "ENROLLED" | "WITHDRAWN", StatusMeta> = {
  SUBMITTED: { label: "Submitted", tone: "info", icon: "inbox" },
  VERIFIED: { label: "Verified", tone: "progress", icon: "list-checks" },
  REJECTED: { label: "Not eligible", tone: "danger", icon: "circle-x" },
  OFFERED: { label: "Offered", tone: "warning", icon: "send" },
  ACCEPTED: { label: "Accepted", tone: "success", icon: "check" },
  DECLINED: { label: "Declined / lapsed", tone: "neutral", icon: "ban" },
  ENROLLED: { label: "Enrolled", tone: "locked", icon: "badge-check" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral", icon: "ban" },
};

export const PLACEMENT_STATUS: Record<"APPLIED" | "SHORTLISTED" | "SELECTED" | "REJECTED" | "WITHDRAWN", StatusMeta> = {
  APPLIED: { label: "Applied", tone: "info", icon: "send" },
  SHORTLISTED: { label: "Shortlisted", tone: "progress", icon: "list-checks" },
  SELECTED: { label: "Selected", tone: "success", icon: "badge-check" },
  REJECTED: { label: "Not selected", tone: "neutral", icon: "circle-x" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral", icon: "ban" },
};

export const DOCUMENT_STATUS: Record<"PENDING" | "VERIFIED" | "REJECTED", StatusMeta> = {
  PENDING: { label: "Awaiting verification", tone: "warning", icon: "circle-dot" },
  VERIFIED: { label: "Verified", tone: "success", icon: "check" },
  REJECTED: { label: "Rejected", tone: "danger", icon: "circle-x" },
};
