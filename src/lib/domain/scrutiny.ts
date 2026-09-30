/**
 * Automatic technical scrutiny of a paper snapshot.
 * Math rendering is validated through an injected function (KaTeX on the server) to keep this module pure.
 */
import { collectAssets, collectMath } from "@/lib/content/parse";
import { paperMarks } from "@/lib/domain/blueprint";
import type { BlueprintSpec, PaperSnapshot } from "@/lib/domain/paper-types";

export interface ScrutinyCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  severity: "blocker" | "warning";
}

export interface ScrutinyContext {
  snapshot: PaperSnapshot;
  blueprint: BlueprintSpec | null;
  expected: { courseCode: string; courseTitle: string; durationMinutes: number; maxMarks: number };
  hasBranding: boolean;
  hasActiveWatermark: boolean;
  setterName: string;
  knownAssetIds: Set<string>;
  validateMath: (tex: string) => string | null; // returns error message or null
}

// Control characters, U+FFFD replacement char, zero-width and bidi-override characters (written as escapes).
const BAD_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD\u200B-\u200F\u202A-\u202E]/;

export function runScrutiny(ctx: ScrutinyContext): ScrutinyCheck[] {
  const { snapshot: s, blueprint: bp, expected } = ctx;
  const items = s.sections.flatMap((x) => x.items);
  const checks: ScrutinyCheck[] = [];
  const add = (key: string, label: string, ok: boolean, detail: string, severity: ScrutinyCheck["severity"] = "blocker") =>
    checks.push({ key, label, ok, detail, severity });

  add("courseCode", "Course code", s.exam.courseCode === expected.courseCode, s.exam.courseCode);
  add("courseTitle", "Course title", s.exam.courseTitle.trim() === expected.courseTitle.trim(), s.exam.courseTitle);
  add(
    "duration",
    "Duration",
    s.exam.durationMinutes === expected.durationMinutes && s.exam.durationMinutes > 0,
    `${s.exam.durationMinutes} minutes`,
  );
  add("maxMarks", "Maximum marks", s.exam.maxMarks === expected.maxMarks, `${s.exam.maxMarks} marks`);

  if (bp) {
    const required = bp.sections.reduce((n, x) => n + x.questionCount, 0);
    add("questionCount", "Question count", items.length === required, `${items.length} of ${required} questions`);
    const bad = bp.sections
      .map((spec) => {
        const sec = s.sections.find((x) => x.label === spec.label);
        const got = sec ? paperMarks([{ attemptCount: sec.attemptCount ?? spec.attemptCount, items: sec.items }]) : 0;
        return got === spec.attemptCount * spec.marksPerQuestion ? null : `§${spec.label}: ${got}/${spec.attemptCount * spec.marksPerQuestion}`;
      })
      .filter(Boolean);
    add("sectionTotals", "Section totals", bad.length === 0, bad.length ? bad.join(", ") : "All sections balanced");
  } else {
    add("questionCount", "Question count", items.length > 0, `${items.length} questions`, "warning");
  }

  const total = paperMarks(s.sections);
  add("totalMarks", "Total marks", total === expected.maxMarks, `${total} / ${expected.maxMarks}`);

  const emptySections = s.sections.filter((x) => x.items.length === 0);
  add("missing", "Missing questions", emptySections.length === 0, emptySections.length ? `Empty: ${emptySections.map((x) => x.label).join(", ")}` : "No empty sections");

  const labels = s.sections.map((x) => x.label.trim().toUpperCase());
  const dupLabels = labels.filter((l, i) => labels.indexOf(l) !== i);
  add("sectionNumbering", "Section numbering", dupLabels.length === 0, dupLabels.length ? `Duplicate section ${dupLabels.join(", ")}` : labels.join(" · "));

  const ids = items.map((i) => i.questionId);
  const dupQ = ids.filter((x, i) => ids.indexOf(x) !== i);
  add("questionNumbering", "Question numbering", dupQ.length === 0, dupQ.length ? `${dupQ.length} repeated question(s)` : `Q1 – Q${items.length}, continuous`);

  const markMismatch = s.sections.flatMap((sec) =>
    sec.marksPerQuestion ? sec.items.filter((i) => i.marks !== sec.marksPerQuestion).map((i) => i.questionCode) : [],
  );
  add("marksAllocation", "Marks allocation", markMismatch.length === 0, markMismatch.length ? `Check ${markMismatch.join(", ")}` : "Consistent per section");

  const hasInstructions = !!s.paper.instructions?.trim() || s.sections.every((x) => !!x.instructions?.trim() || x.attemptCount);
  add("instructions", "Instructions", hasInstructions, hasInstructions ? "General and section instructions present" : "No instructions for candidates");

  add("header", "Header", !!s.exam.institutionName && !!s.exam.sessionName, `${s.exam.institutionName} · ${s.exam.sessionName}`);
  add("pageNumbers", "Page numbers", true, "Applied automatically by the print engine (Page x of y)");
  add("branding", "University branding", ctx.hasBranding, ctx.hasBranding ? "Logo and institution name configured" : "Institution logo not configured", "warning");

  const badChar = items.filter((i) => BAD_CHARS.test(i.body));
  add("specialChars", "Special characters", badChar.length === 0, badChar.length ? `Invalid characters in ${badChar.map((i) => i.questionCode).join(", ")}` : "Clean");

  const mathErrors: string[] = [];
  for (const i of items) {
    for (const tex of collectMath(i.body)) {
      const err = ctx.validateMath(tex);
      if (err) mathErrors.push(`${i.questionCode}: ${err}`);
    }
    if (/(^|[^\\])\$/.test(i.body.replace(/\$[^$]*\$/g, ""))) mathErrors.push(`${i.questionCode}: unbalanced $`);
  }
  add("equations", "Equation rendering", mathErrors.length === 0, mathErrors.length ? mathErrors.slice(0, 3).join("; ") : "All equations render");

  const missingAssets = items.flatMap((i) => collectAssets(i.body).filter((a) => !ctx.knownAssetIds.has(a)).map(() => i.questionCode));
  add("images", "Images", missingAssets.length === 0, missingAssets.length ? `Missing image in ${[...new Set(missingAssets)].join(", ")}` : "All images available");

  const mcqIssues = items.filter((i) => {
    if (i.type !== "MCQ" && i.type !== "ASSERTION_REASON") return false;
    const ch = i.options?.choices ?? [];
    const texts = ch.map((c) => c.text.trim().toLowerCase());
    return ch.length < 2 || new Set(texts).size !== texts.length || texts.some((t) => !t);
  });
  add("answerChoices", "Answer choices", mcqIssues.length === 0, mcqIssues.length ? `Check options of ${mcqIssues.map((i) => i.questionCode).join(", ")}` : "All choices distinct and complete");

  const leaks = items.filter((i) => i.body.toLowerCase().includes(ctx.setterName.toLowerCase()));
  const answerLeak = items.filter((i) => /\b(answer|ans)\s*[:=]/i.test(i.body));
  add(
    "confidentiality",
    "Confidentiality",
    leaks.length === 0 && answerLeak.length === 0 && ctx.hasActiveWatermark,
    leaks.length
      ? "Setter identity appears in paper text"
      : answerLeak.length
        ? `Possible answer text in ${answerLeak.map((i) => i.questionCode).join(", ")}`
        : ctx.hasActiveWatermark
          ? "No identifying data; watermark policy active"
          : "No active watermark policy",
  );

  add("formatting", "Formatting", items.every((i) => i.body.trim().length >= 5), "Question text present and well-formed", "warning");
  return checks;
}

export function scrutinyReady(checks: ScrutinyCheck[]): boolean {
  return checks.every((c) => c.ok || c.severity === "warning");
}
