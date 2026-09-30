/**
 * Timetable rules (pure): clash detection and generation of dated class meetings from weekly slots.
 * Times are "HH:MM" strings in the institution's time zone; dates are calendar days.
 */

export interface Slot {
  id?: string;
  offeringId: string;
  label?: string;
  dayOfWeek: number; // 1 = Monday
  startTime: string;
  endTime: string;
  roomId: string | null;
  instructorIds: string[];
  /** batch/section key; two slots for the same cohort must not overlap */
  cohortKey: string | null;
}

export interface Clash {
  kind: "ROOM" | "INSTRUCTOR" | "COHORT";
  a: Slot;
  b: Slot;
  message: string;
}

export const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

export const overlaps = (a: Pick<Slot, "dayOfWeek" | "startTime" | "endTime">, b: Pick<Slot, "dayOfWeek" | "startTime" | "endTime">) =>
  a.dayOfWeek === b.dayOfWeek && toMinutes(a.startTime) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(a.endTime);

export const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** Clashes between `candidate` and `existing` slots (the candidate's own id is ignored). */
export function findClashes(candidate: Slot, existing: Slot[]): Clash[] {
  const out: Clash[] = [];
  for (const s of existing) {
    if (candidate.id && s.id === candidate.id) continue;
    if (!overlaps(candidate, s)) continue;
    const when = `${DAY_NAMES[s.dayOfWeek]} ${s.startTime}–${s.endTime}`;
    if (candidate.roomId && candidate.roomId === s.roomId) out.push({ kind: "ROOM", a: candidate, b: s, message: `Room already booked ${when}${s.label ? ` (${s.label})` : ""}` });
    const shared = candidate.instructorIds.filter((i) => s.instructorIds.includes(i));
    if (shared.length) out.push({ kind: "INSTRUCTOR", a: candidate, b: s, message: `Instructor already teaching ${when}${s.label ? ` (${s.label})` : ""}` });
    if (candidate.cohortKey && candidate.cohortKey === s.cohortKey && candidate.offeringId !== s.offeringId) out.push({ kind: "COHORT", a: candidate, b: s, message: `Same students already have a class ${when}${s.label ? ` (${s.label})` : ""}` });
  }
  return out;
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a calendar date (UTC-based date objects). */
export const isoWeekday = (d: Date) => ((d.getUTCDay() + 6) % 7) + 1;

export interface Holiday {
  startDate: Date;
  endDate: Date;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Dated meetings for weekly slots between `from` and `to` (inclusive), skipping holidays.
 * Returns the calendar date plus start/end expressed as local wall-clock strings; the caller converts
 * them to instants with the institution's time zone.
 */
export function generateMeetings(slots: Pick<Slot, "dayOfWeek" | "startTime" | "endTime">[], from: Date, to: Date, holidays: Holiday[]) {
  const off = new Set<string>();
  for (const h of holidays) for (let d = new Date(h.startDate); d <= h.endDate; d = new Date(d.getTime() + 86_400_000)) off.add(dayKey(d));
  const out: { date: string; startTime: string; endTime: string; slotIndex: number }[] = [];
  for (let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())); d <= to; d = new Date(d.getTime() + 86_400_000)) {
    if (off.has(dayKey(d))) continue;
    const wd = isoWeekday(d);
    slots.forEach((s, i) => {
      if (s.dayOfWeek === wd) out.push({ date: dayKey(d), startTime: s.startTime, endTime: s.endTime, slotIndex: i });
    });
  }
  return out;
}

/**
 * Convert a wall-clock date + time in an IANA time zone to a UTC instant, without a date library.
 * Uses the zone's offset at that moment (DST-safe for all but the ambiguous hour).
 */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asZone = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(guess - (asZone - guess));
}
