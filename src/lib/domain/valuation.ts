/**
 * Answer-script valuation rules (pure).
 *  - Single valuation: the first valuer's marks are final.
 *  - Double valuation: two independent valuers. If they differ by no more than the allowed difference,
 *    the final mark is their average (or the higher, per policy). Otherwise a third valuation is required,
 *    and the final mark is the average of the third valuation and whichever earlier mark is closer to it.
 *  - Revaluation: a fresh valuation replaces the original only when the change reaches the threshold.
 */

export interface ValuationPolicy {
  doubleValuation: boolean;
  /** allowed difference between the two valuations, as % of the script's maximum marks */
  maxDifferencePercent: number;
  method: "AVERAGE" | "HIGHER";
  /** revaluation changes smaller than this (in marks) leave the original result unchanged */
  revaluationMinChange: number;
}

export type ValuationState =
  | { kind: "WAITING"; next: 1 | 2 }
  | { kind: "THIRD_NEEDED"; difference: number }
  | { kind: "FINAL"; marks: number; basis: string };

const ceilHalf = (n: number) => Math.ceil(n * 2) / 2; // round up to the nearest half mark

export function valuationState(rounds: { round: number; marks: number | null }[], maxMarks: number, policy: ValuationPolicy): ValuationState {
  const m = (r: number) => rounds.find((x) => x.round === r && x.marks !== null)?.marks ?? null;
  const v1 = m(1);
  const v2 = m(2);
  const v3 = m(3);
  if (v1 === null) return { kind: "WAITING", next: 1 };
  if (!policy.doubleValuation) return { kind: "FINAL", marks: v1, basis: "Single valuation" };
  if (v2 === null) return { kind: "WAITING", next: 2 };
  const diff = Math.abs(v1 - v2);
  if (diff <= (policy.maxDifferencePercent / 100) * maxMarks + 1e-9) {
    return policy.method === "HIGHER"
      ? { kind: "FINAL", marks: Math.max(v1, v2), basis: "Higher of two valuations" }
      : { kind: "FINAL", marks: ceilHalf((v1 + v2) / 2), basis: "Average of two valuations" };
  }
  if (v3 === null) return { kind: "THIRD_NEEDED", difference: diff };
  const closer = Math.abs(v3 - v1) <= Math.abs(v3 - v2) ? v1 : v2;
  return { kind: "FINAL", marks: ceilHalf((v3 + closer) / 2), basis: "Third valuation averaged with the closer earlier valuation" };
}

export function revaluationOutcome(original: number, revalued: number, policy: ValuationPolicy): { finalMarks: number; outcome: "UNCHANGED" | "INCREASED" | "DECREASED" } {
  const change = revalued - original;
  if (Math.abs(change) < policy.revaluationMinChange) return { finalMarks: original, outcome: "UNCHANGED" };
  return { finalMarks: revalued, outcome: change > 0 ? "INCREASED" : "DECREASED" };
}
