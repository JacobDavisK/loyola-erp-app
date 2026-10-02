import type { StatusMeta } from "@/lib/domain/labels";

export const NAD_STATUS: Record<"GENERATED" | "SUBMITTED" | "ACKNOWLEDGED" | "REJECTED", StatusMeta> = {
  GENERATED: { label: "Prepared", tone: "info", icon: "circle-dot" },
  SUBMITTED: { label: "Uploaded, awaiting portal", tone: "progress", icon: "send" },
  ACKNOWLEDGED: { label: "Accepted by portal", tone: "success", icon: "badge-check" },
  REJECTED: { label: "Rejected by portal", tone: "danger", icon: "circle-x" },
};

export const EXIT_STATUS: Record<"PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN", StatusMeta> = {
  PENDING: { label: "Awaiting approval", tone: "warning", icon: "circle-dot" },
  APPROVED: { label: "Exited", tone: "success", icon: "stamp" },
  REJECTED: { label: "Not approved", tone: "danger", icon: "circle-x" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral", icon: "ban" },
};

export const CREDIT_STATUS: Record<"PENDING" | "APPROVED" | "REJECTED", StatusMeta> = {
  PENDING: { label: "Under review", tone: "warning", icon: "circle-dot" },
  APPROVED: { label: "Accepted", tone: "success", icon: "check" },
  REJECTED: { label: "Not accepted", tone: "danger", icon: "circle-x" },
};

export const CREDIT_SOURCE: Record<string, string> = { SWAYAM: "SWAYAM", NPTEL: "NPTEL", MOOC: "Other MOOC", INSTITUTION: "Another institution" };

export const DATA_REQUEST_STATUS: Record<"OPEN" | "IN_PROGRESS" | "COMPLETED" | "REJECTED", StatusMeta> = {
  OPEN: { label: "Open", tone: "warning", icon: "circle-dot" },
  IN_PROGRESS: { label: "In progress", tone: "progress", icon: "pencil" },
  COMPLETED: { label: "Completed", tone: "success", icon: "check" },
  REJECTED: { label: "Declined", tone: "neutral", icon: "circle-x" },
};

export const DATA_REQUEST_TYPE: Record<string, string> = {
  ACCESS: "Access my data", CORRECTION: "Correct my data", ERASURE: "Erase my data", NOMINATION: "Nominate someone", GRIEVANCE: "Grievance",
};

export const BREACH_STATUS: Record<"OPEN" | "CONTAINED" | "NOTIFIED" | "CLOSED", StatusMeta> = {
  OPEN: { label: "Open", tone: "danger", icon: "circle-dot" },
  CONTAINED: { label: "Contained", tone: "warning", icon: "lock" },
  NOTIFIED: { label: "Notified", tone: "progress", icon: "send" },
  CLOSED: { label: "Closed", tone: "neutral", icon: "check" },
};

/** Attainment (0–3) shown with a tone; colour is never the only signal (the number is printed). */
export function attainmentTone(v: number | null, target: number): "success" | "warning" | "danger" | "neutral" {
  if (v === null) return "neutral";
  if (v >= target) return "success";
  if (v >= target - 0.5) return "warning";
  return "danger";
}
