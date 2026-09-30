import { differenceInCalendarDays, format, formatDistanceToNowStrict } from "date-fns";

export const fmtDate = (d: Date | string | null | undefined) => (d ? format(new Date(d), "d MMM yyyy") : "—");
export const fmtDateShort = (d: Date | string | null | undefined) => (d ? format(new Date(d), "d MMM") : "—");
export const fmtDateTime = (d: Date | string | null | undefined) => (d ? format(new Date(d), "d MMM yyyy, HH:mm") : "—");
export const fmtRelative = (d: Date | string | null | undefined) => (d ? formatDistanceToNowStrict(new Date(d), { addSuffix: true }) : "—");

export function daysLeft(d: Date | string): number {
  return differenceInCalendarDays(new Date(d), new Date());
}

export function deadlineText(d: Date | string): { text: string; tone: "danger" | "warning" | "neutral" } {
  const n = daysLeft(d);
  if (n < 0) return { text: `${-n} day${n === -1 ? "" : "s"} overdue`, tone: "danger" };
  if (n === 0) return { text: "Due today", tone: "danger" };
  if (n === 1) return { text: "Due tomorrow", tone: "warning" };
  if (n <= 3) return { text: `${n} days remaining`, tone: "warning" };
  return { text: `${n} days remaining`, tone: "neutral" };
}

export function pct(n: number, d: number): number {
  return d ? Math.round((n / d) * 100) : 0;
}

/** Wall-clock time (HH:MM) of an instant in an IANA time zone — class and exam times are shown in the institution's zone. */
export function fmtTime(d: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(d));
}

/** Weekday + date in a time zone, e.g. "Mon 28 Sep". */
export function fmtDayZoned(d: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone }).format(new Date(d));
}

/** "YYYY-MM-DDTHH:mm" of an instant in a time zone, for datetime-local inputs. */
export function toZonedInput(d: Date | string | null | undefined, timeZone: string): string | null {
  if (!d) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Date and time in a time zone, e.g. "12 Oct 2026, 18:00". */
export function fmtDateTimeZoned(d: Date | string | null | undefined, timeZone: string): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(d));
}
