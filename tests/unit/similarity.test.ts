import { describe, expect, it } from "vitest";
import { compareQuestions, findInternalDuplicates, normalize, stem } from "@/lib/domain/similarity";

describe("duplicate detection", () => {
  it("scores identical text (ignoring case and punctuation) as exact", () => {
    const r = compareQuestions({ text: "Define a Stack." }, { text: "define a stack" });
    expect(r.kind).toBe("exact");
    expect(r.score).toBe(1);
  });

  it("flags light rewording as a near duplicate", () => {
    const r = compareQuestions({ text: "Write an algorithm to reverse a singly linked list." }, { text: "Write the algorithm to reverse a singly linked list in place." });
    expect(r.score).toBeGreaterThan(0.6);
    expect(r.kind).not.toBe("distinct");
  });

  it("treats unrelated questions as distinct", () => {
    const r = compareQuestions({ text: "Explain the two-phase locking protocol." }, { text: "Compute the median of 12, 15, 11 and 19." });
    expect(r.kind).toBe("distinct");
    expect(r.score).toBeLessThan(0.3);
  });

  it("recognises the same concept with the same topic", () => {
    const a = { text: "Explain inorder traversal of a binary tree with an example.", topic: "Traversal" };
    const b = { text: "Illustrate inorder traversal of binary trees.", topic: "Traversal" };
    expect(compareQuestions(a, b).concept).toBeGreaterThan(0.4);
  });

  it("ignores maths markup noise", () => {
    expect(normalize("Evaluate $x^2 + 1$ at x = 2")).not.toContain("$");
  });

  it("stems common suffixes", () => {
    expect(stem("traversals")).toBe(stem("traversal"));
    expect(stem("queries")).toBe("query");
  });

  it("finds duplicates inside a list", () => {
    const list = [
      { id: "1", text: "Define a binary search tree." },
      { id: "2", text: "Define binary search trees." },
      { id: "3", text: "What is hashing?" },
    ];
    const d = findInternalDuplicates(list);
    expect(d).toHaveLength(1);
    expect([d[0].a.id, d[0].b.id]).toEqual(["1", "2"]);
  });
});
