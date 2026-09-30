/**
 * Research and quality-assurance rules (pure): grant budget utilisation, DOI handling, accreditation
 * metric outlines and weighted progress. Money is in integer minor units.
 */
import type { Minor } from "./money";

export type BudgetHead = "EQUIPMENT" | "CONSUMABLES" | "TRAVEL" | "MANPOWER" | "CONTINGENCY" | "OVERHEAD";
export const BUDGET_HEADS: BudgetHead[] = ["EQUIPMENT", "CONSUMABLES", "TRAVEL", "MANPOWER", "CONTINGENCY", "OVERHEAD"];

export interface HeadUse { head: BudgetHead; sanctioned: Minor; spent: Minor; remaining: Minor; percent: number }

export function utilisation(lines: { head: BudgetHead; amount: Minor }[], expenses: { head: BudgetHead; amount: Minor }[]): { heads: HeadUse[]; sanctioned: Minor; spent: Minor } {
  const heads = BUDGET_HEADS.map((head) => {
    const sanctioned = lines.filter((l) => l.head === head).reduce((a, l) => a + l.amount, 0);
    const spent = expenses.filter((e) => e.head === head).reduce((a, e) => a + e.amount, 0);
    return { head, sanctioned, spent, remaining: sanctioned - spent, percent: sanctioned ? Math.round((spent / sanctioned) * 1000) / 10 : 0 };
  }).filter((h) => h.sanctioned || h.spent);
  return { heads, sanctioned: heads.reduce((a, h) => a + h.sanctioned, 0), spent: heads.reduce((a, h) => a + h.spent, 0) };
}

/** An expense (positive) must fit in the head's remaining budget; a correction (negative) cannot take spending below zero. */
export function checkExpense(use: HeadUse | undefined, amount: Minor): string | null {
  if (amount === 0) return "The amount cannot be zero.";
  if (!use || use.sanctioned === 0) return amount > 0 ? "Nothing was sanctioned under this head." : "There is no spending to correct under this head.";
  if (amount > 0 && amount > use.remaining) return `Only ${(use.remaining / 100).toFixed(2)} remains under ${use.head.toLowerCase()}.`;
  if (amount < 0 && use.spent + amount < 0) return "A correction cannot take spending below zero.";
  return null;
}

/** Canonical DOI: lower-case, without resolver prefix. Returns null if it is not a DOI. */
export function normaliseDoi(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(s) ? s : null;
}

export interface MetricLine { code: string; title: string; kind: "QUANTITATIVE" | "QUALITATIVE"; weight: number; source: string | null; unit: string | null; parentCode: string | null }

/**
 * Parse a metric outline: one metric per line, `code | title | Q or N (quantitative / narrative) | weight | source | unit`.
 * The parent is the longest existing code that prefixes this one ("3.3.1" → "3.3" → "3").
 */
export function parseOutline(text: string): { lines: MetricLine[]; errors: string[] } {
  const lines: MetricLine[] = [];
  const errors: string[] = [];
  const codes = new Set<string>();
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const [code, title, kind = "N", weight = "0", source = "", unit = ""] = line.split("|").map((x) => x.trim());
    if (!/^[0-9A-Za-z]+(\.[0-9A-Za-z]+)*$/.test(code ?? "")) { errors.push(`Line ${i + 1}: invalid code "${code}"`); return; }
    if (!title) { errors.push(`Line ${i + 1}: missing title`); return; }
    if (codes.has(code)) { errors.push(`Line ${i + 1}: duplicate code ${code}`); return; }
    const w = Number(weight);
    if (!Number.isFinite(w) || w < 0) { errors.push(`Line ${i + 1}: invalid weight`); return; }
    const parts = code.split(".");
    let parentCode: string | null = null;
    for (let k = parts.length - 1; k > 0; k--) {
      const p = parts.slice(0, k).join(".");
      if (codes.has(p)) { parentCode = p; break; }
    }
    codes.add(code);
    lines.push({ code, title, kind: kind.toUpperCase().startsWith("Q") ? "QUANTITATIVE" : "QUALITATIVE", weight: w, source: source || null, unit: unit || null, parentCode });
  });
  return { lines, errors };
}

export type ResponseStatus = "NOT_STARTED" | "DRAFT" | "SUBMITTED" | "APPROVED" | "RETURNED";

/** Weighted progress: approved counts fully, submitted half, anything else zero. Unweighted metrics count as 1. */
export function cycleProgress(items: { weight: number; status: ResponseStatus }[]) {
  const w = (x: { weight: number }) => (x.weight > 0 ? x.weight : 1);
  const total = items.reduce((a, x) => a + w(x), 0);
  const score = items.reduce((a, x) => a + (x.status === "APPROVED" ? w(x) : x.status === "SUBMITTED" ? w(x) / 2 : 0), 0);
  const count = (s: ResponseStatus) => items.filter((x) => x.status === s).length;
  return {
    percent: total ? Math.round((score / total) * 1000) / 10 : 0,
    approved: count("APPROVED"), submitted: count("SUBMITTED"), draft: count("DRAFT") + count("RETURNED"), notStarted: count("NOT_STARTED"), total: items.length,
  };
}
