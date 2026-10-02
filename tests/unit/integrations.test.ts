import { describe, expect, it } from "vitest";
import { buildIcs, domainAllowed, expectedIssuer, idTokenEmail, isPrivateAddress, retryDelayMs, webhookMatches } from "@/lib/domain/integrations";
import { LOCALES, SOURCE_STRINGS, dictionary, translate } from "@/lib/i18n";
import { NAV } from "@/components/shell/nav";

describe("webhook events", () => {
  it("matches subscribed prefixes and never sends confidential areas", () => {
    expect(webhookMatches("payment.record", ["payment."])).toBe(true);
    expect(webhookMatches("payment.record", ["invoice."])).toBe(false);
    expect(webhookMatches("student.create", ["student.create"])).toBe(true);
    expect(webhookMatches("paper.submit", ["paper."])).toBe(false);
    expect(webhookMatches("auth.login", ["auth."])).toBe(false);
    expect(webhookMatches("grievance.raise", ["grievance."])).toBe(false);
  });
  it("backs off and eventually gives up", () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(6)).toBe(24 * 3_600_000);
    expect(retryDelayMs(7)).toBeNull();
  });
  it("recognises private network addresses", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "192.168.1.9", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "2001:4860::8888"]) expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("single sign-on checks", () => {
  it("resolves Microsoft's tenant issuer template", () => {
    expect(expectedIssuer("https://login.microsoftonline.com/{tenantid}/v2.0", { tid: "abc" })).toBe("https://login.microsoftonline.com/abc/v2.0");
    expect(expectedIssuer("https://accounts.google.com", {})).toBe("https://accounts.google.com");
  });
  it("needs a verified e-mail and an allowed domain", () => {
    expect(idTokenEmail("GOOGLE", { email: "A@Loyola.edu", email_verified: true })).toBe("a@loyola.edu");
    expect(idTokenEmail("GOOGLE", { email: "a@loyola.edu", email_verified: false })).toBeNull();
    expect(idTokenEmail("MICROSOFT", { preferred_username: "b@loyola.edu" })).toBe("b@loyola.edu");
    expect(domainAllowed("a@loyola.edu", ["loyola.edu"])).toBe(true);
    expect(domainAllowed("a@evil-loyola.edu", ["loyola.edu"])).toBe(false);
    expect(domainAllowed("a@x.com", [])).toBe(true);
  });
});

describe("calendar", () => {
  it("writes valid, escaped, folded ICS", () => {
    const ics = buildIcs("Test; cal", [
      { uid: "a@erp", title: "BCS301 Data structures, lab", startsAt: new Date("2026-10-05T03:30:00Z"), endsAt: new Date("2026-10-05T04:30:00Z"), location: "SB-L1" },
      { uid: "b@erp", title: "Holiday", startsAt: new Date("2026-10-20T00:00:00Z"), endsAt: new Date("2026-10-20T00:00:00Z"), allDay: true, description: "x".repeat(200) },
    ], new Date("2026-10-01T00:00:00Z"));
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("X-WR-CALNAME:Test\\; cal");
    expect(ics).toContain("DTSTART:20261005T033000Z");
    expect(ics).toContain("SUMMARY:BCS301 Data structures\\, lab");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261020");
    expect(ics).toContain("DTEND;VALUE=DATE:20261021");
    expect(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
  });
});

describe("interface languages", () => {
  it("translates every navigation label into Tamil and Hindi", () => {
    const labels = new Set(NAV.flatMap((g) => [g.label, ...g.items.map((i) => i.label)]));
    for (const l of labels) {
      expect(SOURCE_STRINGS, `missing translation for "${l}"`).toContain(l);
      expect(translate("ta", l)).not.toBe(l);
      expect(translate("hi", l)).not.toBe(l);
    }
    for (const locale of ["ta", "hi"] as const) {
      const d = dictionary(locale);
      expect(Object.keys(d).length).toBe(new Set(SOURCE_STRINGS).size);
      expect(Object.values(d).every((v) => v.trim().length > 0)).toBe(true);
    }
    expect(translate("en", "Attendance")).toBe("Attendance");
    expect(translate("ta", "Attendance")).toBe("வருகைப் பதிவு");
    expect(translate("hi", "Not in the dictionary")).toBe("Not in the dictionary");
    expect(Object.keys(LOCALES)).toEqual(["en", "ta", "hi"]);
  });
});
