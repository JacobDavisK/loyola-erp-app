import type { BlueprintSpec, PaperItemData, PaperSectionData } from "@/lib/domain/paper-types";

let n = 0;
export function item(p: Partial<PaperItemData> = {}): PaperItemData {
  n++;
  return {
    itemId: `i${n}`,
    questionId: `q${n}`,
    questionCode: `Q-${String(n).padStart(6, "0")}`,
    versionId: `v${n}`,
    version: 1,
    body: `Question number ${n} about topic ${n}`,
    options: null,
    marks: 2,
    type: "SHORT",
    difficulty: "EASY",
    bloom: "REMEMBER",
    unitNumber: 1,
    outcomeCode: "CO1",
    topic: null,
    ...p,
  };
}

export function section(label: string, items: PaperItemData[], p: Partial<PaperSectionData> = {}): PaperSectionData {
  return { id: `s-${label}`, label, title: `Section ${label}`, instructions: null, attemptCount: null, marksPerQuestion: null, items, ...p };
}

/** The standard 75-mark LOCF pattern: A 10×2, B 5 of 7 ×5, C 3 of 5 ×10. */
export const PATTERN: BlueprintSpec = {
  totalMarks: 75,
  durationMinutes: 180,
  sections: [
    { label: "A", title: "A", questionCount: 10, attemptCount: 10, marksPerQuestion: 2, questionTypes: [], units: [1, 2, 3, 4, 5] },
    { label: "B", title: "B", questionCount: 7, attemptCount: 5, marksPerQuestion: 5, questionTypes: [], units: [1, 2, 3, 4, 5] },
    { label: "C", title: "C", questionCount: 5, attemptCount: 3, marksPerQuestion: 10, questionTypes: [], units: [1, 2, 3, 4, 5] },
  ],
  rules: [
    { dimension: "DIFFICULTY", key: "EASY", targetPercent: 30, tolerance: 8 },
    { dimension: "DIFFICULTY", key: "MODERATE", targetPercent: 50, tolerance: 8 },
    { dimension: "DIFFICULTY", key: "HARD", targetPercent: 20, tolerance: 8 },
  ],
};

/** A paper that exactly satisfies PATTERN (105 item-marks: 31 easy / 54 moderate / 20 hard ≈ 29.5/51.4/19.0 %). */
export function compliantPaper(): PaperSectionData[] {
  const u = (i: number) => (i % 5) + 1;
  return [
    section("A", Array.from({ length: 10 }, (_, i) => item({ marks: 2, unitNumber: u(i), difficulty: "EASY" })), { attemptCount: 10, marksPerQuestion: 2 }),
    section("B", Array.from({ length: 7 }, (_, i) => item({ marks: 5, unitNumber: u(i), difficulty: i < 2 ? "EASY" : "MODERATE" })), { attemptCount: 5, marksPerQuestion: 5 }),
    section("C", Array.from({ length: 5 }, (_, i) => item({ marks: 10, unitNumber: u(i), difficulty: i < 3 ? "MODERATE" : "HARD" })), { attemptCount: 3, marksPerQuestion: 10 }),
  ];
}
