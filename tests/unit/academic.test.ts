import { describe, expect, it } from "vitest";
import { DEFAULT_ATTENDANCE_POLICY, summarise, type Mark } from "@/lib/domain/attendance";
import { csvCell, parseCsv, parseCsvObjects, toCsv } from "@/lib/domain/csv";
import { auditDegree, type CurriculumSpec } from "@/lib/domain/degree-audit";
import { blocking, registrationViolations, type RegistrationFacts } from "@/lib/domain/registration";
import { findClashes, generateMeetings, isoWeekday, overlaps, zonedTimeToUtc, type Slot } from "@/lib/domain/timetable";

const marks = (spec: Record<Mark, number>) => Object.entries(spec).flatMap(([m, n]) => Array<Mark>(n).fill(m as Mark));

describe("attendance policy", () => {
  it("counts present-type marks and excludes approved leave from the denominator", () => {
    const s = summarise(marks({ PRESENT: 30, LATE: 3, ON_DUTY: 2, ABSENT: 5, MEDICAL: 4, EXCUSED: 0 }), DEFAULT_ATTENDANCE_POLICY);
    expect(s.counted).toBe(40);
    expect(s.attended).toBe(35);
    expect(s.percent).toBe(87.5);
    expect(s.standing).toBe("OK");
  });
  it("classifies condonation and shortage bands and projects recovery", () => {
    const condonable = summarise(marks({ PRESENT: 14, ABSENT: 6, LATE: 0, ON_DUTY: 0, MEDICAL: 0, EXCUSED: 0 }), DEFAULT_ATTENDANCE_POLICY, 10);
    expect(condonable.percent).toBe(70);
    expect(condonable.standing).toBe("CONDONABLE");
    // (14 + n) / (20 + n) >= 0.75  →  n >= 4
    expect(condonable.mustAttend).toBe(4);
    const shortage = summarise(marks({ PRESENT: 5, ABSENT: 5, LATE: 0, ON_DUTY: 0, MEDICAL: 0, EXCUSED: 0 }), DEFAULT_ATTENDANCE_POLICY);
    expect(shortage.standing).toBe("SHORTAGE");
  });
  it("tells a student how many more classes they can miss", () => {
    // 18/20 now, 20 more classes: total 40, need 30 → can miss up to 8
    const s = summarise(marks({ PRESENT: 18, ABSENT: 2, LATE: 0, ON_DUTY: 0, MEDICAL: 0, EXCUSED: 0 }), DEFAULT_ATTENDANCE_POLICY, 20);
    expect(s.canMiss).toBe(8);
    expect(summarise([], DEFAULT_ATTENDANCE_POLICY).standing).toBe("NO_CLASSES");
  });
});

const facts = (patch: Partial<RegistrationFacts> = {}): RegistrationFacts => ({
  studentStatus: "ACTIVE",
  window: { opensAt: new Date("2026-07-01"), closesAt: new Date("2026-07-10") },
  now: new Date("2026-07-05"),
  staffOverride: false,
  offering: { status: "OPEN", capacity: 30, registered: 10, programId: null, batchId: null, credits: 4, courseId: "c1" },
  student: { programId: "p1", batchId: "b1" },
  alreadyRegisteredCourseIds: [],
  creditsThisTerm: 16,
  maxCreditsPerTerm: 24,
  prerequisites: [],
  clashesWith: [],
  ...patch,
});

describe("course registration rules", () => {
  it("accepts an eligible student", () => {
    expect(registrationViolations(facts())).toEqual([]);
  });
  it("reports every problem at once", () => {
    const v = registrationViolations(facts({
      now: new Date("2026-08-01"),
      offering: { status: "OPEN", capacity: 30, registered: 30, programId: null, batchId: "b2", credits: 10, courseId: "c1" },
      prerequisites: [{ courseId: "c0", code: "BCS101", passed: false }],
      clashesWith: ["BCS302"],
    }));
    expect(v.map((x) => x.code).sort()).toEqual(["CLASH", "CREDITS", "FULL", "PREREQUISITE", "PROGRAM", "WINDOW"]);
  });
  it("lets staff override soft rules but never hard ones", () => {
    const v = registrationViolations(facts({ staffOverride: true, studentStatus: "SUSPENDED", offering: { status: "OPEN", capacity: 1, registered: 1, programId: null, batchId: null, credits: 4, courseId: "c1" } }));
    expect(blocking(v, true).map((x) => x.code)).toEqual(["STATUS"]);
    expect(registrationViolations(facts({ alreadyRegisteredCourseIds: ["c1"] })).map((x) => x.code)).toEqual(["DUPLICATE"]);
  });
});

describe("timetable", () => {
  const base: Slot = { offeringId: "o1", dayOfWeek: 1, startTime: "09:00", endTime: "10:00", roomId: "R1", instructorIds: ["t1"], cohortKey: "b1:A" };
  it("detects overlaps only when intervals intersect on the same day", () => {
    expect(overlaps(base, { ...base, startTime: "09:30", endTime: "10:30" })).toBe(true);
    expect(overlaps(base, { ...base, startTime: "10:00", endTime: "11:00" })).toBe(false);
    expect(overlaps(base, { ...base, dayOfWeek: 2 })).toBe(false);
  });
  it("classifies room, instructor and cohort clashes", () => {
    const kinds = findClashes({ ...base, offeringId: "o2" }, [{ ...base, id: "s1" }]).map((c) => c.kind).sort();
    expect(kinds).toEqual(["COHORT", "INSTRUCTOR", "ROOM"]);
    expect(findClashes({ ...base, id: "s1" }, [{ ...base, id: "s1" }])).toEqual([]);
  });
  it("generates dated sessions and skips holidays", () => {
    const from = new Date("2026-09-28T00:00:00Z"); // Monday
    const to = new Date("2026-10-04T00:00:00Z");
    const out = generateMeetings([{ dayOfWeek: 1, startTime: "09:00", endTime: "10:00" }, { dayOfWeek: 5, startTime: "11:00", endTime: "12:00" }], from, to, [{ startDate: new Date("2026-10-02T00:00:00Z"), endDate: new Date("2026-10-02T00:00:00Z") }]);
    expect(out.map((m) => m.date)).toEqual(["2026-09-28"]);
    expect(isoWeekday(new Date("2026-10-04T00:00:00Z"))).toBe(7);
  });
  it("converts institution wall-clock time to UTC", () => {
    expect(zonedTimeToUtc("2026-09-28", "09:00", "Asia/Kolkata").toISOString()).toBe("2026-09-28T03:30:00.000Z");
    expect(zonedTimeToUtc("2026-07-01", "09:00", "Europe/London").toISOString()).toBe("2026-07-01T08:00:00.000Z");
  });
});

describe("CSV", () => {
  it("parses quoted fields, embedded newlines, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi""\nthen left"\r\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"\nthen left']]);
    const { headers, rows } = parseCsvObjects("First Name,E-mail\nAsha,a@x.edu\n\n");
    expect(headers).toEqual(["first_name", "e_mail"]);
    expect(rows).toEqual([{ first_name: "Asha", e_mail: "a@x.edu" }]);
  });
  it("neutralises spreadsheet formula injection when writing", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(toCsv(["a"], [["x,y"]])).toBe('a\r\n"x,y"\r\n');
  });
});

describe("degree audit", () => {
  const spec: CurriculumSpec = {
    totalCredits: 20,
    minCgpa: 5,
    groups: [{ code: "DSE", name: "Elective", minCredits: 4 }],
    requirements: [{ kind: "CATEGORY_CREDITS", label: "Project", courseTypes: ["PROJECT"], minCredits: 4 }],
    courses: [
      { courseId: "m1", code: "M1", title: "Core 1", credits: 4, semester: 1, category: "MANDATORY", groupCode: null, courseType: "CORE" },
      { courseId: "m2", code: "M2", title: "Core 2", credits: 4, semester: 2, category: "MANDATORY", groupCode: null, courseType: "CORE" },
      { courseId: "e1", code: "E1", title: "Elective 1", credits: 4, semester: 2, category: "ELECTIVE", groupCode: "DSE", courseType: "ELECTIVE" },
      { courseId: "p1", code: "P1", title: "Project", credits: 4, semester: 3, category: "MANDATORY", groupCode: null, courseType: "PROJECT" },
    ],
  };
  it("computes progress and lists what is still needed", () => {
    const a = auditDegree(spec, [
      { courseId: "m1", code: "M1", credits: 4, courseType: "CORE", passed: true, attempts: 1 },
      { courseId: "m2", code: "M2", credits: 4, courseType: "CORE", passed: false, attempts: 1 },
    ], 6.2);
    expect(a.earnedCredits).toBe(4);
    expect(a.percent).toBe(20);
    expect(a.mandatory.remaining.map((c) => c.code)).toEqual(["M2", "P1"]);
    expect(a.failed).toEqual([{ code: "M2", attempts: 1 }]);
    expect(a.eligible).toBe(false);
    expect(a.blockers.length).toBeGreaterThanOrEqual(3);
  });
  it("marks a student eligible once everything is complete, counting repeats once", () => {
    const rec = ["m1", "m2", "e1", "p1"].map((id) => ({ courseId: id, code: id.toUpperCase(), credits: 4, courseType: id === "p1" ? "PROJECT" : id === "e1" ? "ELECTIVE" : "CORE", passed: true, attempts: id === "m2" ? 2 : 1 }));
    const a = auditDegree({ ...spec, totalCredits: 16 }, rec, 7.1);
    expect(a.eligible).toBe(true);
    expect(a.repeated).toEqual([{ code: "M2", attempts: 2 }]);
    expect(auditDegree({ ...spec, totalCredits: 16 }, rec, 4.2).blockers.some((b) => b.includes("CGPA"))).toBe(true);
  });
});
