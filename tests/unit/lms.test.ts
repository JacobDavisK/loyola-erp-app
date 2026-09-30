import { describe, expect, it } from "vitest";
import { applyPenalty, attemptDeadline, checkWindow, gradeAnswer, gradeAttempt, reviewVisibility, scaleScore, seededShuffle } from "@/lib/domain/lms";

const due = new Date("2026-10-10T18:00:00Z");

describe("assignment windows", () => {
  it("accepts on-time, penalises late within the window, refuses after close", () => {
    const w = { dueAt: due, closesAt: new Date("2026-10-12T18:00:00Z"), latePenaltyPercent: 20 };
    expect(checkWindow(w, new Date("2026-10-10T17:59:59Z"))).toEqual({ open: true, late: false, penalty: 0 });
    expect(checkWindow(w, new Date("2026-10-11T10:00:00Z"))).toEqual({ open: true, late: true, penalty: 0.2 });
    expect(checkWindow(w, new Date("2026-10-13T00:00:00Z")).open).toBe(false);
    expect(checkWindow({ ...w, closesAt: null }, new Date("2026-10-10T18:00:01Z")).open).toBe(false);
    expect(applyPenalty(18, 0.2)).toBe(14.4);
  });
});

describe("quiz grading", () => {
  it("grades each question type", () => {
    expect(gradeAnswer({ id: "1", type: "SINGLE", marks: 2, answer: { correct: ["b"] } }, "b")).toBe(2);
    expect(gradeAnswer({ id: "1", type: "SINGLE", marks: 2, answer: { correct: ["b"] } }, "a")).toBe(0);
    const multi = { id: "2", type: "MULTIPLE" as const, marks: 4, answer: { correct: ["a", "c"] } };
    expect(gradeAnswer(multi, ["c", "a"])).toBe(4);
    expect(gradeAnswer(multi, ["a"])).toBe(0);
    expect(gradeAnswer({ ...multi, answer: { correct: ["a", "c"], partial: true } }, ["a"])).toBe(2);
    expect(gradeAnswer({ ...multi, answer: { correct: ["a", "c"], partial: true } }, ["a", "b"])).toBe(0);
    expect(gradeAnswer({ id: "3", type: "TRUE_FALSE", marks: 1, answer: { correct: false } }, false)).toBe(1);
    expect(gradeAnswer({ id: "4", type: "SHORT", marks: 1, answer: { accepted: ["Binary search"] } }, "  binary   SEARCH ")).toBe(1);
    expect(gradeAnswer({ id: "4", type: "SHORT", marks: 1, answer: { accepted: ["Binary search"], caseSensitive: true } }, "binary search")).toBe(0);
    expect(gradeAnswer({ id: "5", type: "NUMERIC", marks: 3, answer: { value: 3.14, tolerance: 0.01 } }, "3.145")).toBe(3);
    expect(gradeAnswer({ id: "5", type: "NUMERIC", marks: 3, answer: { value: 3.14, tolerance: 0.01 } }, "abc")).toBe(0);
    expect(gradeAnswer({ id: "5", type: "NUMERIC", marks: 3, answer: { value: 3.14 } }, undefined)).toBe(0);
  });
  it("totals an attempt", () => {
    const r = gradeAttempt([{ id: "a", type: "TRUE_FALSE", marks: 1, answer: { correct: true } }, { id: "b", type: "SINGLE", marks: 2, answer: { correct: ["x"] } }], { a: true, b: "y" });
    expect(r).toEqual({ awarded: { a: 1, b: 0 }, score: 1, maxScore: 3 });
  });
  it("ends attempts at the time limit or the close, whichever is first", () => {
    const start = new Date("2026-10-01T10:00:00Z");
    expect(attemptDeadline(start, new Date("2026-10-01T12:00:00Z"), 30).toISOString()).toBe("2026-10-01T10:30:00.000Z");
    expect(attemptDeadline(start, new Date("2026-10-01T10:10:00Z"), 30).toISOString()).toBe("2026-10-01T10:10:00.000Z");
    expect(attemptDeadline(start, new Date("2026-10-01T12:00:00Z"), null).toISOString()).toBe("2026-10-01T12:00:00.000Z");
  });
  it("shuffles deterministically per seed", () => {
    const items = ["a", "b", "c", "d", "e", "f"];
    expect(seededShuffle(items, "s1")).toEqual(seededShuffle(items, "s1"));
    expect(seededShuffle(items, "s1").sort()).toEqual(items);
    expect(seededShuffle(items, "s1").join()).not.toBe(seededShuffle(items, "s2").join());
  });
  it("controls review visibility", () => {
    expect(reviewVisibility("AFTER_CLOSE", false)).toEqual({ score: false, answers: false });
    expect(reviewVisibility("AFTER_CLOSE", true)).toEqual({ score: true, answers: true });
    expect(reviewVisibility("SCORE_ONLY", false)).toEqual({ score: true, answers: false });
  });
  it("scales gradebook scores into components", () => {
    expect(scaleScore(18, 20, 10)).toBe(9);
    expect(scaleScore(25, 20, 10)).toBe(10);
    expect(scaleScore(7, 0, 10)).toBe(0);
  });
});
