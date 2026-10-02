/**
 * Integration rules (pure): API token scopes, the webhook event catalogue, single sign-on checks and
 * calendar (ICS) output.
 */

// ───────────────────────── API scopes ─────────────────────────

/** What a token may be used for. A token never grants more than its owner's own permissions. */
export const API_SCOPES = {
  "profile:read": "Your own profile",
  "self:read": "Your own (or your ward's) attendance, results, fees and timetable",
  "students:read": "Student records you are allowed to see",
  "academics:read": "Programmes, courses and course offerings",
  "finance:read": "Invoices and balances you are allowed to see",
  "events:read": "Campus events and announcements",
  "operations:read": "Stock levels, assets and room bookings you manage",
} as const;
export type ApiScope = keyof typeof API_SCOPES;
export const isApiScope = (s: string): s is ApiScope => s in API_SCOPES;

export const TOKEN_PREFIX = "ecp_";

// ───────────────────────── Webhooks ─────────────────────────

/**
 * Events other systems can subscribe to, by prefix of the audit action. Confidential areas — examination
 * papers and marks, sign-ins, counselling, grievances, health, privacy — are never sent.
 */
export const WEBHOOK_EVENTS = {
  "student.": "Student records created, updated, status changes",
  "admission.": "Admissions: applications, offers, enrolment",
  "invoice.": "Fee invoices issued or cancelled",
  "payment.": "Fee payments received or reversed",
  "refund.": "Refunds",
  "scholarship.": "Scholarships and concessions",
  "result.": "Results published or withheld",
  "credential.": "Certificates and degree credentials issued or revoked",
  "library.": "Library circulation",
  "placement.": "Placement drives and offers",
  "event.": "Campus events",
  "procurement.": "Purchase requests, orders, receipts and vendor bills",
  "inventory.": "Stores issues and counts",
  "asset.": "Asset register changes",
  "facility.": "Room bookings",
  "hr.": "Employee records and leave",
} as const;
export type WebhookEvent = keyof typeof WEBHOOK_EVENTS;

const NEVER = ["auth.", "paper.", "question.", "exam.", "marks.", "valuation.", "revaluation.", "blueprint.", "counselling.", "grievance.", "clinic.", "privacy.", "success.", "mentoring.", "session.", "backup.", "settings."];

/** Whether an audit action is sent to an endpoint subscribed to these prefixes. */
export function webhookMatches(action: string, subscribed: readonly string[]): boolean {
  if (NEVER.some((p) => action.startsWith(p))) return false;
  if (!Object.keys(WEBHOOK_EVENTS).some((p) => action.startsWith(p))) return false;
  return subscribed.some((p) => action === p || (p.endsWith(".") && action.startsWith(p)));
}

/** Delay before the next delivery attempt (attempt counts from 1); null = give up. */
export function retryDelayMs(attempt: number): number | null {
  const steps = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000, 24 * 3_600_000];
  return attempt <= steps.length ? steps[attempt - 1] : null;
}

/** Private, loopback and link-local addresses a webhook must not reach (SSRF). */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.replace(/^::ffff:/, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const [a, b] = v4.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

// ───────────────────────── Single sign-on ─────────────────────────

/** Microsoft's multi-tenant discovery documents give the issuer as a template with {tenantid}. */
export function expectedIssuer(template: string, claims: Record<string, unknown>): string {
  return template.includes("{tenantid}") ? template.replace("{tenantid}", String(claims.tid ?? "")) : template;
}

/** The verified e-mail address in an ID token, or null. */
export function idTokenEmail(kind: "GOOGLE" | "MICROSOFT", claims: Record<string, unknown>): string | null {
  if (kind === "GOOGLE") return claims.email_verified === true && typeof claims.email === "string" ? claims.email.toLowerCase() : null;
  const e = typeof claims.email === "string" ? claims.email : typeof claims.preferred_username === "string" ? claims.preferred_username : null;
  return e && e.includes("@") ? e.toLowerCase() : null;
}

export function domainAllowed(email: string, allowed: readonly string[]): boolean {
  if (!allowed.length) return true;
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return allowed.some((d) => domain === d.toLowerCase().replace(/^@/, ""));
}

// ───────────────────────── Calendar (RFC 5545) ─────────────────────────

export interface CalendarEvent {
  uid: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  location?: string | null;
  description?: string | null;
  allDay?: boolean;
}

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsDay = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");

/** Lines longer than 75 octets are folded with CRLF + space. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, "utf8") > 74) { out.push(cur); cur = " "; }
    cur += ch;
  }
  out.push(cur);
  return out.join("\r\n");
}

export function buildIcs(name: string, events: CalendarEvent[], now = new Date()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Loyola University//ERP//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc(name)}`, "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${icsDate(now)}`);
    if (e.allDay) lines.push(`DTSTART;VALUE=DATE:${icsDay(e.startsAt)}`, `DTEND;VALUE=DATE:${icsDay(new Date(Math.max(e.endsAt.getTime(), e.startsAt.getTime() + 86_400_000)))}`);
    else lines.push(`DTSTART:${icsDate(e.startsAt)}`, `DTEND:${icsDate(e.endsAt)}`);
    lines.push(`SUMMARY:${esc(e.title)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
