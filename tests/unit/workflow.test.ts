import { describe, expect, it } from "vitest";
import type { PaperStatus } from "@/generated/prisma/enums";
import { canTransition, FROZEN, getTransition, nextStatus, nextVersion, SETTER_EDITABLE, TRANSITIONS, transitionsFrom, WorkflowError, type PaperAction } from "@/lib/domain/workflow";

describe("paper workflow state machine", () => {
  it("follows the happy path from draft to archive", () => {
    const path: PaperAction[] = ["submit", "start_moderation", "moderation_approve", "scrutiny_pass", "approve", "lock", "release", "archive"];
    let s: PaperStatus = "DRAFT";
    for (const a of path) s = nextStatus(s, a);
    expect(s).toBe("ARCHIVED");
  });

  it("supports the revision loop", () => {
    let s: PaperStatus = nextStatus("UNDER_MODERATION", "moderation_request_changes");
    expect(s).toBe("REVISION_REQUIRED");
    s = nextStatus(s, "resubmit");
    expect(s).toBe("RESUBMITTED");
    expect(nextStatus(s, "start_moderation")).toBe("UNDER_MODERATION");
  });

  it("rejects every unauthorised transition", () => {
    expect(() => nextStatus("DRAFT", "approve")).toThrow(WorkflowError);
    expect(() => nextStatus("DRAFT", "lock")).toThrow(WorkflowError);
    expect(() => nextStatus("SUBMITTED", "scrutiny_pass")).toThrow(WorkflowError);
    expect(() => nextStatus("LOCKED", "submit")).toThrow(WorkflowError);
    expect(() => nextStatus("LOCKED", "reopen")).toThrow(WorkflowError); // locked versions are immutable
    expect(() => nextStatus("ARCHIVED", "release")).toThrow(WorkflowError);
  });

  it("offers nothing to do on an archived paper", () => {
    expect(transitionsFrom("ARCHIVED")).toHaveLength(0);
  });

  it("requires remarks for every negative decision", () => {
    for (const a of ["moderation_request_changes", "moderation_reject", "scrutiny_return", "approval_return", "approval_reject", "reopen"] as const) {
      expect(getTransition(a).requiresNote).toBe(true);
    }
  });

  it("assigns each action to the right actor and permission", () => {
    expect(getTransition("submit")).toMatchObject({ actor: "owner", permission: "paper.submit" });
    expect(getTransition("moderation_approve")).toMatchObject({ actor: "moderator", permission: "moderation.perform" });
    expect(getTransition("scrutiny_pass")).toMatchObject({ actor: "scrutinizer", permission: "scrutiny.perform" });
    expect(getTransition("approve")).toMatchObject({ actor: "approver", permission: "paper.approve" });
    expect(getTransition("lock")).toMatchObject({ actor: "authority", permission: "paper.lock" });
  });

  it("never lets a setter edit frozen content", () => {
    for (const s of FROZEN) expect(SETTER_EDITABLE).not.toContain(s);
  });

  it("every transition's target is reachable only from its sources", () => {
    for (const t of TRANSITIONS) for (const from of t.from) expect(canTransition(from, t.action)).toBe(true);
  });
});

describe("version numbering", () => {
  it("starts at 1.0, increments minor, and finalises to the next major", () => {
    let v = nextVersion({ major: 0, minor: 0 }, "minor");
    expect(v.label).toBe("1.0");
    v = nextVersion(v, "minor");
    expect(v.label).toBe("1.1");
    v = nextVersion(v, "minor");
    expect(v.label).toBe("1.2");
    const f = nextVersion(v, "major-final");
    expect(f).toMatchObject({ label: "2.0 FINAL", isFinal: true, major: 2, minor: 0 });
  });
});
