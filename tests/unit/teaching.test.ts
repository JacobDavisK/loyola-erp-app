import { describe, expect, it } from "vitest";
import { schedule, weeklyLoad, type SchedRequest } from "@/lib/domain/scheduler";
import { distanceMeters, documentSimilarity, locationCheck, qrStep, shingles, similarityPairs, summariseSurvey, validateAnswers } from "@/lib/domain/teaching";
import { overlaps } from "@/lib/domain/timetable";

const periods: [string, string][] = [["09:00", "09:50"], ["09:50", "10:40"], ["11:00", "11:50"], ["11:50", "12:40"]];
const rooms = [{ id: "r1", code: "R101", capacity: 60, type: "CLASSROOM" }, { id: "r2", code: "R102", capacity: 40, type: "CLASSROOM" }, { id: "lab", code: "LAB1", capacity: 40, type: "LAB" }];
const req = (id: string, extra: Partial<SchedRequest> = {}): SchedRequest => ({ offeringId: id, label: id, lectures: 3, labs: 0, size: 40, instructorIds: [`t-${id}`], cohortKey: "A", ...extra });

describe("timetable generator", () => {
  it("places every session without clashes and spreads a class over days", () => {
    const r = schedule({ days: [1, 2, 3], periods, rooms, requests: [req("c1"), req("c2"), req("c3", { labs: 1, lectures: 1 })], fixed: [], maxInstructorPeriodsPerDay: 4 });
    expect(r.unplaced).toHaveLength(0);
    expect(r.stats.placed).toBe(r.stats.requested);
    // Same cohort: no two sessions overlap.
    const s = r.placements.map((p) => ({ ...p, dayOfWeek: p.day }));
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) expect(overlaps(s[i], s[j])).toBe(false);
    // Each lecture class uses three different days.
    expect(new Set(r.placements.filter((p) => p.offeringId === "c1").map((p) => p.day)).size).toBe(3);
    // The lab is two consecutive periods in the lab room.
    const lab = r.placements.find((p) => p.kind === "LAB")!;
    expect(lab.roomId).toBe("lab");
    expect([["09:00", "10:40"], ["11:00", "12:40"]]).toContainEqual([lab.startTime, lab.endTime]);
  });
  it("respects fixed slots and reports what cannot be placed, with the reason", () => {
    const fixed = [1, 2].flatMap((day) => periods.map(([start, end]) => ({ offeringId: "x", day, start, end, roomId: null, instructorIds: ["busy"], cohortKey: null })));
    const r = schedule({ days: [1, 2], periods, rooms, requests: [req("c1", { instructorIds: ["busy"] }), req("big", { size: 120, cohortKey: "B" })], fixed, maxInstructorPeriodsPerDay: 6 });
    expect(r.placements).toHaveLength(0);
    expect(r.unplaced.find((u) => u.offeringId === "c1")?.reason).toMatch(/teacher/);
    expect(r.unplaced.find((u) => u.offeringId === "big")?.reason).toMatch(/120/);
  });
  it("derives weekly load from credits and mode", () => {
    expect(weeklyLoad({ credits: 4, mode: "THEORY" }, { weeklyLectures: null, weeklyLabs: null })).toEqual({ lectures: 4, labs: 0 });
    expect(weeklyLoad({ credits: 2, mode: "PRACTICAL" }, { weeklyLectures: null, weeklyLabs: null })).toEqual({ lectures: 0, labs: 1 });
    expect(weeklyLoad({ credits: 4, mode: "THEORY_PRACTICAL" }, { weeklyLectures: 2, weeklyLabs: null })).toEqual({ lectures: 2, labs: 1 });
  });
});

describe("QR check-in", () => {
  it("measures distance and allows for GPS accuracy", () => {
    expect(Math.round(distanceMeters(13.0827, 80.2707, 13.0827, 80.2717))).toBeGreaterThan(100);
    expect(locationCheck({ lat: 13.0827, lng: 80.2707, accuracy: 15 }, { lat: 13.0828, lng: 80.2707, radius: 50 }).ok).toBe(true);
    expect(locationCheck({ lat: 13.0827, lng: 80.2707, accuracy: 15 }, { lat: 13.0927, lng: 80.2707, radius: 50 }).ok).toBe(false);
    expect(locationCheck({ lat: 13.0827, lng: 80.2707, accuracy: 900 }, { lat: 13.0827, lng: 80.2707, radius: 50 }).reason).toMatch(/imprecise/);
  });
  it("changes the code every 20 seconds", () => {
    expect(qrStep(0)).toBe(0);
    expect(qrStep(19_999)).toBe(0);
    expect(qrStep(20_000)).toBe(1);
  });
});

describe("submission similarity", () => {
  const base = "Normalisation removes redundancy from relational tables by decomposing them into smaller tables that satisfy normal forms such as third normal form and Boyce Codd normal form";
  it("detects copied passages and ignores unrelated text", () => {
    const copied = `My answer. ${base}. That is all I have to say about the topic.`;
    const other = "A deadlock happens when processes wait for each other forever because each holds a resource the next one needs";
    expect(documentSimilarity(shingles(base), shingles(copied)).score).toBe(100);
    expect(documentSimilarity(shingles(base), shingles(other)).score).toBe(0);
    const pairs = similarityPairs([{ id: "a", text: base }, { id: "b", text: copied }, { id: "c", text: other }]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ a: "a", b: "b" });
    expect(pairs[0].sample).toBeTruthy();
  });
});

describe("surveys", () => {
  const qs = [{ id: "q1", type: "LIKERT" as const, text: "Clear" }, { id: "q2", type: "CHOICE" as const, text: "Where", options: ["A", "B"] }, { id: "q3", type: "TEXT" as const, text: "Why" }];
  it("validates answers", () => {
    expect(validateAnswers(qs, { q1: 4, q2: "A", q3: "fine" })).toBeNull();
    expect(validateAnswers(qs, { q1: 6 })).toMatch(/1–5/);
    expect(validateAnswers(qs, { q2: "C" })).toMatch(/options/);
  });
  it("summarises means, distributions and comments", () => {
    const s = summariseSurvey(qs, [{ q1: 4, q2: "A", q3: "good" }, { q1: 2, q2: "A" }, { q1: 5 }]);
    expect(s[0]).toMatchObject({ answered: 3, mean: 3.67 });
    expect(s[1].distribution).toEqual({ A: 2, B: 0 });
    expect(s[2].comments).toEqual(["good"]);
  });
});
