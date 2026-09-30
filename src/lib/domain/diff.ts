import { paperMarks } from "@/lib/domain/blueprint";
import type { PaperItemData, PaperSnapshot } from "@/lib/domain/paper-types";

export interface VersionDiff {
  added: { section: string; item: PaperItemData }[];
  removed: { section: string; item: PaperItemData }[];
  modified: { section: string; before: PaperItemData; after: PaperItemData; changes: string[] }[];
  moved: { questionCode: string; from: string; to: string }[];
  instructionChanges: { scope: string; before: string; after: string }[];
  marks: { before: number; after: number };
}

export function diffSnapshots(a: PaperSnapshot, b: PaperSnapshot): VersionDiff {
  const index = (s: PaperSnapshot) => {
    const m = new Map<string, { section: string; item: PaperItemData; position: number }>();
    let pos = 0;
    for (const sec of s.sections) for (const item of sec.items) m.set(item.questionId, { section: sec.label, item, position: pos++ });
    return m;
  };
  const ia = index(a);
  const ib = index(b);
  const diff: VersionDiff = {
    added: [],
    removed: [],
    modified: [],
    moved: [],
    instructionChanges: [],
    marks: { before: paperMarks(a.sections), after: paperMarks(b.sections) },
  };

  for (const [qid, x] of ib) {
    const prev = ia.get(qid);
    if (!prev) {
      diff.added.push({ section: x.section, item: x.item });
      continue;
    }
    const changes: string[] = [];
    if (prev.item.versionId !== x.item.versionId) changes.push(`text revised (v${prev.item.version} → v${x.item.version})`);
    if (prev.item.marks !== x.item.marks) changes.push(`marks ${prev.item.marks} → ${x.item.marks}`);
    if (changes.length) diff.modified.push({ section: x.section, before: prev.item, after: x.item, changes });
    if (prev.section !== x.section) diff.moved.push({ questionCode: x.item.questionCode, from: prev.section, to: x.section });
  }
  for (const [qid, x] of ia) if (!ib.has(qid)) diff.removed.push({ section: x.section, item: x.item });

  const norm = (v: string | null | undefined) => (v ?? "").trim();
  if (norm(a.paper.instructions) !== norm(b.paper.instructions)) {
    diff.instructionChanges.push({ scope: "General instructions", before: norm(a.paper.instructions), after: norm(b.paper.instructions) });
  }
  for (const sb of b.sections) {
    const sa = a.sections.find((s) => s.label === sb.label);
    if (sa && norm(sa.instructions) !== norm(sb.instructions)) {
      diff.instructionChanges.push({ scope: `Section ${sb.label}`, before: norm(sa.instructions), after: norm(sb.instructions) });
    }
  }
  return diff;
}

export function isEmptyDiff(d: VersionDiff): boolean {
  return !d.added.length && !d.removed.length && !d.modified.length && !d.moved.length && !d.instructionChanges.length;
}
