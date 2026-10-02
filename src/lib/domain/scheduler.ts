/**
 * Timetable generator (pure, deterministic). Places each class's weekly lectures (one period) and lab
 * sessions (two consecutive periods) into the institution's bell schedule so that no room, teacher or
 * cohort is double-booked, labs go to lab rooms, rooms are big enough, and a class's sessions are spread
 * over different days. Existing slots are kept fixed. Sessions that cannot be placed are reported with
 * the reason, so the timetable officer can relax a constraint or place them by hand.
 */
import { toMinutes } from "@/lib/domain/timetable";

export interface BellPeriod {
  day: number;
  index: number;
  start: string;
  end: string;
}

export interface SchedRoom {
  id: string;
  code: string;
  capacity: number;
  type: string;
}

export interface SchedRequest {
  offeringId: string;
  label: string;
  lectures: number;
  labs: number;
  size: number;
  instructorIds: string[];
  cohortKey: string | null;
}

export interface FixedSlot {
  offeringId: string;
  day: number;
  start: string;
  end: string;
  roomId: string | null;
  instructorIds: string[];
  cohortKey: string | null;
}

export interface Placement {
  offeringId: string;
  label: string;
  kind: "LECTURE" | "LAB";
  day: number;
  startTime: string;
  endTime: string;
  roomId: string;
  roomCode: string;
}

export interface Unplaced {
  offeringId: string;
  label: string;
  kind: "LECTURE" | "LAB";
  reason: string;
}

export interface ScheduleInput {
  days: number[];
  periods: [string, string][];
  rooms: SchedRoom[];
  requests: SchedRequest[];
  fixed: FixedSlot[];
  maxInstructorPeriodsPerDay: number;
}

const LAB_TYPES = new Set(["LAB"]);
const LECTURE_TYPES = new Set(["CLASSROOM", "SEMINAR_HALL", "AUDITORIUM"]);

/** Expand the bell schedule into periods per day. */
export function bellPeriods(days: number[], periods: [string, string][]): BellPeriod[] {
  return days.flatMap((day) => periods.map(([start, end], index) => ({ day, index, start, end })));
}

/** Two periods are back-to-back when the gap between them is at most 10 minutes. */
const consecutive = (a: BellPeriod, b: BellPeriod) => a.day === b.day && toMinutes(b.start) - toMinutes(a.end) <= 10 && toMinutes(b.start) >= toMinutes(a.end);

export function schedule(input: ScheduleInput): { placements: Placement[]; unplaced: Unplaced[]; stats: { requested: number; placed: number; periodsUsed: number } } {
  const periods = bellPeriods(input.days, input.periods);
  const byDay = new Map<number, BellPeriod[]>();
  for (const p of periods) (byDay.get(p.day) ?? byDay.set(p.day, []).get(p.day)!).push(p);

  const busy = { room: new Set<string>(), teacher: new Set<string>(), cohort: new Set<string>() };
  const key = (who: string, p: BellPeriod) => `${who}@${p.day}:${p.index}`;
  const teacherLoad = new Map<string, number>(); // teacher@day → periods
  const classDays = new Map<string, Set<number>>(); // offering → days used

  // Fixed slots occupy every bell period they overlap.
  for (const f of input.fixed) {
    for (const p of byDay.get(f.day) ?? []) {
      if (!(toMinutes(p.start) < toMinutes(f.end) && toMinutes(f.start) < toMinutes(p.end))) continue;
      if (f.roomId) busy.room.add(key(f.roomId, p));
      for (const t of f.instructorIds) { busy.teacher.add(key(t, p)); teacherLoad.set(`${t}@${p.day}`, (teacherLoad.get(`${t}@${p.day}`) ?? 0) + 1); }
      if (f.cohortKey) busy.cohort.add(key(f.cohortKey, p));
    }
    (classDays.get(f.offeringId) ?? classDays.set(f.offeringId, new Set()).get(f.offeringId)!).add(f.day);
  }

  // Sessions to place: labs first (they need two periods and a lab), then by class size and teacher load.
  const teacherDemand = new Map<string, number>();
  for (const r of input.requests) for (const t of r.instructorIds) teacherDemand.set(t, (teacherDemand.get(t) ?? 0) + r.lectures + 2 * r.labs);
  const sessions = input.requests.flatMap((r) => [
    ...Array.from({ length: r.labs }, () => ({ r, kind: "LAB" as const, len: 2 })),
    ...Array.from({ length: r.lectures }, () => ({ r, kind: "LECTURE" as const, len: 1 })),
  ]);
  const demand = (r: SchedRequest) => Math.max(0, ...r.instructorIds.map((t) => teacherDemand.get(t) ?? 0));
  sessions.sort((a, b) => b.len - a.len || b.r.size - a.r.size || demand(b.r) - demand(a.r) || a.r.label.localeCompare(b.r.label));

  const placements: Placement[] = [];
  const unplaced: Unplaced[] = [];
  for (const s of sessions) {
    const types = s.kind === "LAB" ? LAB_TYPES : LECTURE_TYPES;
    const rooms = input.rooms.filter((rm) => types.has(rm.type) && rm.capacity >= s.r.size).sort((a, b) => a.capacity - b.capacity || a.code.localeCompare(b.code));
    if (!rooms.length) {
      unplaced.push({ offeringId: s.r.offeringId, label: s.r.label, kind: s.kind, reason: s.kind === "LAB" ? `No lab room holds ${s.r.size} students.` : `No classroom holds ${s.r.size} students.` });
      continue;
    }
    let best: { score: number; ps: BellPeriod[]; room: SchedRoom } | null = null;
    let teacherBlocked = 0;
    for (const day of input.days) {
      const list = byDay.get(day) ?? [];
      for (let i = 0; i + s.len <= list.length; i++) {
        const ps = list.slice(i, i + s.len);
        if (s.len > 1 && !ps.every((p, k) => k === 0 || consecutive(ps[k - 1], p))) continue;
        if (s.r.cohortKey && ps.some((p) => busy.cohort.has(key(s.r.cohortKey!, p)))) continue;
        if (s.r.instructorIds.some((t) => ps.some((p) => busy.teacher.has(key(t, p))) || (teacherLoad.get(`${t}@${day}`) ?? 0) + s.len > input.maxInstructorPeriodsPerDay)) { teacherBlocked++; continue; }
        const room = rooms.find((rm) => ps.every((p) => !busy.room.has(key(rm.id, p))));
        if (!room) continue;
        const sameDay = classDays.get(s.r.offeringId)?.has(day) ? 10 : 0;
        const load = s.r.instructorIds.reduce((a, t) => a + (teacherLoad.get(`${t}@${day}`) ?? 0), 0) * 1.5;
        const fit = (room.capacity - s.r.size) / Math.max(1, s.r.size);
        const score = sameDay + load + fit + ps[0].index * 0.15 + day * 0.01;
        if (!best || score < best.score) best = { score, ps, room };
      }
    }
    if (!best) {
      unplaced.push({ offeringId: s.r.offeringId, label: s.r.label, kind: s.kind, reason: teacherBlocked ? "The teacher or the students have no common free period (or the teacher's daily limit is reached)." : "No free room in any period the students and teacher are free." });
      continue;
    }
    for (const p of best.ps) {
      busy.room.add(key(best.room.id, p));
      for (const t of s.r.instructorIds) busy.teacher.add(key(t, p));
      if (s.r.cohortKey) busy.cohort.add(key(s.r.cohortKey, p));
    }
    for (const t of s.r.instructorIds) teacherLoad.set(`${t}@${best.ps[0].day}`, (teacherLoad.get(`${t}@${best.ps[0].day}`) ?? 0) + s.len);
    (classDays.get(s.r.offeringId) ?? classDays.set(s.r.offeringId, new Set()).get(s.r.offeringId)!).add(best.ps[0].day);
    placements.push({ offeringId: s.r.offeringId, label: s.r.label, kind: s.kind, day: best.ps[0].day, startTime: best.ps[0].start, endTime: best.ps.at(-1)!.end, roomId: best.room.id, roomCode: best.room.code });
  }
  placements.sort((a, b) => a.day - b.day || a.startTime.localeCompare(b.startTime) || a.label.localeCompare(b.label));
  return { placements, unplaced, stats: { requested: sessions.length, placed: placements.length, periodsUsed: placements.reduce((a, p) => a + (p.kind === "LAB" ? 2 : 1), 0) } };
}

/** Weekly load of a class from the course when the class does not override it. */
export function weeklyLoad(course: { credits: number; mode: "THEORY" | "PRACTICAL" | "THEORY_PRACTICAL" }, override: { weeklyLectures: number | null; weeklyLabs: number | null }) {
  const lectures = override.weeklyLectures ?? (course.mode === "PRACTICAL" ? 0 : course.mode === "THEORY_PRACTICAL" ? Math.max(1, course.credits - 1) : course.credits);
  const labs = override.weeklyLabs ?? (course.mode === "PRACTICAL" ? Math.max(1, Math.round(course.credits / 2)) : course.mode === "THEORY_PRACTICAL" ? 1 : 0);
  return { lectures, labs };
}
