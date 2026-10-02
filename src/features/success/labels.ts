import type { StatusMeta } from "@/lib/domain/labels";

export const RISK_LEVEL: Record<"LOW" | "MEDIUM" | "HIGH", StatusMeta> = {
  LOW: { label: "Low risk", tone: "success", icon: "check" },
  MEDIUM: { label: "Medium risk", tone: "warning", icon: "circle-dot" },
  HIGH: { label: "High risk", tone: "danger", icon: "circle-x" },
};

export const CASE_STATUS: Record<"OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED", StatusMeta> = {
  OPEN: { label: "Open", tone: "warning", icon: "circle-dot" },
  IN_PROGRESS: { label: "In progress", tone: "progress", icon: "pencil" },
  RESOLVED: { label: "Resolved", tone: "success", icon: "check" },
  CLOSED: { label: "Closed", tone: "neutral", icon: "lock" },
};

export const CASE_SOURCE: Record<string, string> = { SYSTEM: "Early warning", STAFF: "Raised by staff", SELF: "Student asked for help" };
export const NOTE_KIND: Record<string, string> = { NOTE: "Note", CONTACT: "Contact", REFERRAL: "Referral", STATUS: "Status" };
export const MEETING_MODE: Record<string, string> = { IN_PERSON: "In person", ONLINE: "Online", PHONE: "Phone" };

export interface RiskFactorView { key: string; label: string; risk: number; weight: number; detail: string }
