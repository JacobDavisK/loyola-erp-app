import { describe, expect, it } from "vitest";
import { attendanceOf, canTransition, formatPublicId, identityForGuest, identityForUser, joinWindowOpen, MEETING_TYPES, parseIdentity, presentSeconds, PUBLIC_ID, qualityLabel, relativeStart } from "@/lib/domain/video";

const t = (min: number) => new Date(Date.UTC(2026, 9, 5, 4, 0) + min * 60_000);

describe("meeting lifecycle", () => {
  it("allows only valid transitions", () => {
    expect(canTransition("DRAFT", "SCHEDULED")).toBe(true);
    expect(canTransition("SCHEDULED", "STARTING")).toBe(true);
    expect(canTransition("STARTING", "LIVE")).toBe(true);
    expect(canTransition("LIVE", "ENDED")).toBe(true);
    expect(canTransition("SCHEDULED", "FAILED")).toBe(true);
    expect(canTransition("SCHEDULED", "CANCELLED")).toBe(true);
    expect(canTransition("DRAFT", "LIVE")).toBe(false);
    expect(canTransition("LIVE", "CANCELLED")).toBe(false);
    expect(canTransition("ENDED", "LIVE")).toBe(false);
    expect(canTransition("CANCELLED", "SCHEDULED")).toBe(false);
  });
  it("opens the join window from shortly before the start until the end", () => {
    expect(joinWindowOpen(t(-20), t(0), t(60), "SCHEDULED", 15)).toBe(false);
    expect(joinWindowOpen(t(-10), t(0), t(60), "SCHEDULED", 15)).toBe(true);
    expect(joinWindowOpen(t(61), t(0), t(60), "SCHEDULED", 15)).toBe(false);
    expect(joinWindowOpen(t(90), t(0), t(60), "LIVE", 15)).toBe(true);
    expect(joinWindowOpen(t(10), t(0), t(60), "CANCELLED", 15)).toBe(false);
  });
});

describe("identifiers", () => {
  it("formats readable meeting ids for every type", () => {
    expect(formatPublicId("ONLINE_CLASS", 2026, 184)).toBe("ERP-ACD-2026-000184");
    for (const k of Object.keys(MEETING_TYPES)) expect(formatPublicId(k as keyof typeof MEETING_TYPES, 2026, 1)).toMatch(PUBLIC_ID);
    expect(new Set(Object.values(MEETING_TYPES).map((m) => m.code)).size).toBe(Object.keys(MEETING_TYPES).length);
  });
  it("round-trips provider identities and rejects anything else", () => {
    expect(parseIdentity(identityForUser("cmur2xgyu03p5s8v8asfey48o"))).toEqual({ kind: "user", id: "cmur2xgyu03p5s8v8asfey48o" });
    expect(parseIdentity(identityForGuest("cmur2xgyu03p5s8v8asfey48o"))).toEqual({ kind: "guest", id: "cmur2xgyu03p5s8v8asfey48o" });
    expect(parseIdentity("admin")).toBeNull();
    expect(parseIdentity("u_x'; drop table")).toBeNull();
  });
});

describe("attendance", () => {
  const rule = { presentPercent: 75, partialMinMinutes: 5 };
  it("counts only time inside the meeting and never double-counts overlaps", () => {
    expect(presentSeconds([{ joinedAt: t(0), leftAt: t(52) }], t(0), t(60))).toBe(52 * 60);
    expect(presentSeconds([{ joinedAt: t(-10), leftAt: t(10) }], t(0), t(60))).toBe(10 * 60);
    expect(presentSeconds([{ joinedAt: t(0), leftAt: t(30) }, { joinedAt: t(10), leftAt: t(40) }, { joinedAt: t(10), leftAt: t(40) }], t(0), t(60))).toBe(40 * 60);
    expect(presentSeconds([{ joinedAt: t(0), leftAt: t(10) }, { joinedAt: t(20), leftAt: t(30) }], t(0), t(60))).toBe(20 * 60);
    expect(presentSeconds([{ joinedAt: t(50), leftAt: null }], t(0), t(60))).toBe(10 * 60);
    expect(presentSeconds([], t(0), t(60))).toBe(0);
  });
  it("classifies by the institution's threshold", () => {
    expect(attendanceOf(52 * 60, 60 * 60, rule)).toEqual({ percentage: 86.67, status: "PRESENT" });
    expect(attendanceOf(45 * 60, 60 * 60, rule)).toEqual({ percentage: 75, status: "PRESENT" });
    expect(attendanceOf(30 * 60, 60 * 60, rule)).toEqual({ percentage: 50, status: "PARTIALLY_PRESENT" });
    expect(attendanceOf(2 * 60, 60 * 60, rule)).toEqual({ percentage: 3.33, status: "ABSENT" });
    expect(attendanceOf(90 * 60, 60 * 60, rule).percentage).toBe(100);
  });
});

describe("presentation helpers", () => {
  it("describes timing and connection quality plainly", () => {
    expect(relativeStart(t(0), t(12), "SCHEDULED")).toBe("Starts in 12 min");
    expect(relativeStart(t(5), t(0), "SCHEDULED")).toBe("Started 5 min ago");
    expect(relativeStart(t(5), t(0), "LIVE")).toBe("Live now");
    expect(qualityLabel("excellent")).toBe("Excellent");
    expect(qualityLabel("poor")).toBe("Poor");
    expect(qualityLabel("lost")).toBe("Reconnecting");
    expect(qualityLabel("good", true)).toBe("Reconnecting");
  });
});
