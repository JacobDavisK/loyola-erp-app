/**
 * Video & collaboration rules (pure): meeting types, the lifecycle state machine, attendance from
 * connection intervals, and identifiers. No I/O here, so every rule is unit-tested.
 */

export const MEETING_TYPES = {
  ONLINE_CLASS: { label: "Online class", code: "ACD", restricted: false, defaultVisibility: "COURSE", lobby: false },
  FACULTY_MEETING: { label: "Faculty meeting", code: "FAC", restricted: false, defaultVisibility: "INVITED", lobby: false },
  DEPARTMENT_MEETING: { label: "Department meeting", code: "DEP", restricted: false, defaultVisibility: "DEPARTMENT", lobby: false },
  STUDENT_MENTORING: { label: "Mentoring session", code: "MEN", restricted: true, defaultVisibility: "INVITED", lobby: false },
  PARENT_MEETING: { label: "Parent meeting", code: "PAR", restricted: true, defaultVisibility: "INVITED", lobby: true },
  VIVA_VOCE: { label: "Viva voce", code: "VIV", restricted: true, defaultVisibility: "INVITED", lobby: true },
  PHD_REVIEW: { label: "PhD review", code: "PHD", restricted: true, defaultVisibility: "INVITED", lobby: true },
  RESEARCH_MEETING: { label: "Research meeting", code: "RES", restricted: false, defaultVisibility: "INVITED", lobby: false },
  WEBINAR: { label: "Webinar", code: "WEB", restricted: false, defaultVisibility: "INSTITUTION", lobby: false },
  GUEST_LECTURE: { label: "Guest lecture", code: "GLE", restricted: false, defaultVisibility: "INSTITUTION", lobby: false },
  WORKSHOP: { label: "Workshop", code: "WRK", restricted: false, defaultVisibility: "INVITED", lobby: false },
  PLACEMENT_INTERVIEW: { label: "Placement interview", code: "PLC", restricted: true, defaultVisibility: "INVITED", lobby: true },
  ADMISSION_INTERVIEW: { label: "Admission interview", code: "ADM", restricted: true, defaultVisibility: "INVITED", lobby: true },
  EXAMINATION_MEETING: { label: "Examination committee", code: "EXM", restricted: true, defaultVisibility: "INVITED", lobby: false },
  ADMINISTRATIVE_MEETING: { label: "Administrative meeting", code: "ADN", restricted: false, defaultVisibility: "INVITED", lobby: false },
  GENERAL_MEETING: { label: "Meeting", code: "GEN", restricted: false, defaultVisibility: "INVITED", lobby: false },
} as const;
export type MeetingType = keyof typeof MEETING_TYPES;
export const isMeetingType = (s: unknown): s is MeetingType => typeof s === "string" && s in MEETING_TYPES;

/** Panel designations used in viva voce and PhD reviews. */
export const PANEL_ROLES = {
  VIVA_VOCE: ["CANDIDATE", "INTERNAL_EXAMINER", "EXTERNAL_EXAMINER", "CHAIR"],
  PHD_REVIEW: ["CANDIDATE", "SUPERVISOR", "CO_SUPERVISOR", "COMMITTEE_MEMBER", "EXTERNAL_EXPERT", "CHAIR"],
} as const;

export const NOTE_KINDS = {
  VIVA_VOCE: ["EXAMINER_NOTE", "RESULT"],
  PHD_REVIEW: ["REVIEW_NOTE", "RECOMMENDATION", "FOLLOW_UP"],
  STUDENT_MENTORING: ["MENTOR_NOTE", "FOLLOW_UP"],
} as const;

// ───────────────────────── Lifecycle ─────────────────────────

export type MeetingStatus = "DRAFT" | "SCHEDULED" | "STARTING" | "LIVE" | "ENDED" | "CANCELLED" | "FAILED";

const TRANSITIONS: Record<MeetingStatus, MeetingStatus[]> = {
  DRAFT: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["STARTING", "CANCELLED", "FAILED", "DRAFT"],
  STARTING: ["LIVE", "FAILED", "SCHEDULED"],
  LIVE: ["ENDED", "FAILED"],
  FAILED: ["SCHEDULED", "STARTING", "CANCELLED"],
  ENDED: [],
  CANCELLED: [],
};

export function canTransition(from: MeetingStatus, to: MeetingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

// ───────────────────────── Identifiers ─────────────────────────

/** ERP-ACD-2026-000184 */
export function formatPublicId(type: MeetingType, year: number, seq: number): string {
  return `ERP-${MEETING_TYPES[type].code}-${year}-${String(seq).padStart(6, "0")}`;
}
export const PUBLIC_ID = /^ERP-[A-Z]{3}-\d{4}-\d{6}$/;

/** Provider identities: never a database id from the client — derived on the server. */
export const identityForUser = (userId: string) => `u_${userId}`;
export const identityForGuest = (guestId: string) => `g_${guestId}`;
export function parseIdentity(identity: string): { kind: "user" | "guest"; id: string } | null {
  const m = /^(u|g)_([a-z0-9]{10,40})$/.exec(identity);
  return m ? { kind: m[1] === "u" ? "user" : "guest", id: m[2] } : null;
}

// ───────────────────────── Attendance ─────────────────────────

export interface Interval { joinedAt: Date; leftAt: Date | null }

/**
 * Seconds actually present within the meeting window: intervals are clipped to [start, end] and merged,
 * so overlapping connections (two tabs, reconnects, repeated events) never count twice.
 */
export function presentSeconds(intervals: Interval[], start: Date, end: Date): number {
  const s = start.getTime(), e = end.getTime();
  const clipped = intervals
    .map((i) => [Math.max(i.joinedAt.getTime(), s), Math.min((i.leftAt ?? end).getTime(), e)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0, curA = -1, curB = -1;
  for (const [a, b] of clipped) {
    if (a > curB) { if (curB > curA) total += curB - curA; curA = a; curB = b; }
    else curB = Math.max(curB, b);
  }
  if (curB > curA) total += curB - curA;
  return Math.round(total / 1000);
}

export interface AttendanceRule { presentPercent: number; partialMinMinutes: number }

export function attendanceOf(seconds: number, meetingSeconds: number, rule: AttendanceRule) {
  const pct = meetingSeconds > 0 ? Math.min(100, Math.round((seconds / meetingSeconds) * 10000) / 100) : 0;
  const status: "PRESENT" | "PARTIALLY_PRESENT" | "ABSENT" = pct >= rule.presentPercent ? "PRESENT" : seconds >= rule.partialMinMinutes * 60 ? "PARTIALLY_PRESENT" : "ABSENT";
  return { percentage: pct, status };
}

// ───────────────────────── Scheduling ─────────────────────────

/** Whether someone may join now: from `earlyMinutes` before the start until the meeting ends. */
export function joinWindowOpen(now: Date, scheduledStart: Date, scheduledEnd: Date, status: MeetingStatus, earlyMinutes: number): boolean {
  if (status === "LIVE" || status === "STARTING") return true;
  if (status !== "SCHEDULED") return false;
  return now.getTime() >= scheduledStart.getTime() - earlyMinutes * 60_000 && now < scheduledEnd;
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

/** "Starts in 12 min", "Live now", "Started 5 min ago" — for cards. */
export function relativeStart(now: Date, start: Date, status: MeetingStatus): string {
  if (status === "LIVE") return "Live now";
  const min = Math.round((start.getTime() - now.getTime()) / 60_000);
  if (min > 0 && min < 60) return `Starts in ${min} min`;
  if (min <= 0 && min > -60) return `Started ${-min} min ago`;
  return "";
}

// ───────────────────────── Connection quality ─────────────────────────

export type QualityLabel = "Excellent" | "Good" | "Poor" | "Reconnecting" | "Unknown";
/** Maps the SDK's connection quality ("excellent" | "good" | "poor" | "lost" | "unknown") to plain words. */
export function qualityLabel(q: string, reconnecting = false): QualityLabel {
  if (reconnecting || q === "lost") return "Reconnecting";
  return q === "excellent" ? "Excellent" : q === "good" ? "Good" : q === "poor" ? "Poor" : "Unknown";
}
