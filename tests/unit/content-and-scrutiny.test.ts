import katex from "katex";
import { describe, expect, it } from "vitest";
import { collectAssets, collectMath, parseContent, toPlainText } from "@/lib/content/parse";
import { diffSnapshots, isEmptyDiff } from "@/lib/domain/diff";
import type { PaperSnapshot } from "@/lib/domain/paper-types";
import { runScrutiny, scrutinyReady } from "@/lib/domain/scrutiny";
import { chainHash } from "@/lib/hash";
import { PATTERN, compliantPaper, item } from "./fixtures";

describe("question content parser", () => {
  it("parses paragraphs, tables, code, maths and images", () => {
    const blocks = parseContent("Evaluate $x^2$.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```\ncode\n```\n\n$$\\int x$$\n\n![Fig](asset:abc123)");
    expect(blocks.map((b) => b.t)).toEqual(["p", "table", "code", "math", "img"]);
    expect(collectMath("a $x$ b $$y$$")).toEqual(["x", "y"]);
    expect(collectAssets("![c](asset:z9)")).toEqual(["z9"]);
  });

  it("never emits raw HTML (script is plain text)", () => {
    const blocks = parseContent("<script>alert(1)</script>");
    expect(blocks[0]).toEqual({ t: "p", c: [{ t: "text", v: "<script>alert(1)</script>" }] });
  });

  it("produces searchable plain text", () => {
    expect(toPlainText("**Bold** and *italic* with `code`")).toBe("Bold and italic with code");
  });
});

function snapshot(sections = compliantPaper()): PaperSnapshot {
  return {
    schema: 1,
    paper: { id: "p", code: "BCS301-NOV2026-A", title: "t", setLabel: "A", instructions: "Answer as directed." },
    exam: { institutionName: "Example University", sessionName: "November 2026", sessionCode: "NOV2026", examTypeLabel: "Regular", courseCode: "BCS301", courseTitle: "Data Structures", programName: "BCA", semesterName: "Semester III", regulationCode: "R2023", durationMinutes: 180, maxMarks: 75 },
    sections,
  };
}

const validateMath = (tex: string) => {
  try {
    katex.renderToString(tex, { throwOnError: true });
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

describe("automatic scrutiny", () => {
  const base = { blueprint: PATTERN, expected: { courseCode: "BCS301", courseTitle: "Data Structures", durationMinutes: 180, maxMarks: 75 }, hasBranding: true, hasActiveWatermark: true, setterName: "Siddiqui", knownAssetIds: new Set<string>(), validateMath };

  it("passes a correct paper", () => {
    const checks = runScrutiny({ ...base, snapshot: snapshot() });
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(scrutinyReady(checks)).toBe(true);
  });

  it("catches wrong course code, marks and broken equations", () => {
    const s = snapshot();
    s.exam.courseCode = "BCS999";
    s.sections[0].items[0] = item({ body: "Evaluate $\\frac{1}{$ now" });
    s.sections[0].items.pop();
    const failed = runScrutiny({ ...base, snapshot: s }).filter((c) => !c.ok).map((c) => c.key);
    expect(failed).toEqual(expect.arrayContaining(["courseCode", "totalMarks", "equations", "questionCount"]));
  });

  it("flags setter identity leaking into the paper", () => {
    const s = snapshot();
    s.sections[0].items[0] = item({ body: "Prepared by Dr. Siddiqui: define a stack." });
    expect(runScrutiny({ ...base, snapshot: s }).find((c) => c.key === "confidentiality")?.ok).toBe(false);
  });

  it("flags missing images", () => {
    const s = snapshot();
    s.sections[0].items[0] = item({ body: "Refer to the figure.\n\n![fig](asset:missing1)" });
    expect(runScrutiny({ ...base, snapshot: s }).find((c) => c.key === "images")?.ok).toBe(false);
  });
});

describe("version comparison", () => {
  it("reports added, removed, modified and instruction changes", () => {
    const a = snapshot();
    const b = structuredClone(a);
    const removed = b.sections[0].items.pop()!;
    b.sections[0].items.push(item({ marks: 2 }));
    b.sections[1].items[0] = { ...b.sections[1].items[0], versionId: "new-version", version: 2 };
    b.paper.instructions = "Answer ALL questions.";
    const d = diffSnapshots(a, b);
    expect(d.removed.map((x) => x.item.questionId)).toEqual([removed.questionId]);
    expect(d.added).toHaveLength(1);
    expect(d.modified[0].changes[0]).toMatch(/v1 → v2/);
    expect(d.instructionChanges).toHaveLength(1);
    expect(isEmptyDiff(diffSnapshots(a, structuredClone(a)))).toBe(true);
  });
});

describe("audit hash chain", () => {
  it("links every entry to its predecessor and detects tampering", () => {
    const e = { actorId: "u", action: "paper.lock", resourceType: "paper", resourceId: "p", oldValue: null, newValue: { status: "LOCKED" }, createdAt: new Date("2026-09-24T10:00:00Z") };
    const h1 = chainHash(null, e);
    const h2 = chainHash(h1, { ...e, action: "paper.release" });
    expect(h2).not.toBe(chainHash(null, { ...e, action: "paper.release" }));
    expect(chainHash(null, { ...e, newValue: { status: "DRAFT" } })).not.toBe(h1);
    expect(chainHash(null, { ...e, newValue: { status: "LOCKED" } })).toBe(h1); // key order independent
  });
});
