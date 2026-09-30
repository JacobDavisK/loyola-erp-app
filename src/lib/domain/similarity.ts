/**
 * Duplicate / near-duplicate question detection.
 *
 *  - exact:     identical after normalisation
 *  - wording:   character-trigram Jaccard (catches re-typed or lightly edited text)
 *  - lexical:   TF cosine over stemmed unigrams + bigrams
 *  - concept:   overlap of stemmed content keywords (+ topic match), approximating "same underlying concept"
 *
 * The database narrows candidates with pg_trgm / full-text search; this module produces the final score.
 */

const STOPWORDS = new Set(
  (
    "a an the and or but if then else of to in on at by for with from as is are was were be been being this that these those " +
    "it its into about above below between during under over again further than so such very can could should would will shall " +
    "may might must do does did doing have has had having what which who whom whose when where why how all any both each few more " +
    "most other some no nor not only own same too s t just don now i me my we our you your he him his she her they them their " +
    "briefly explain describe discuss define write short note notes state list give examine elucidate enumerate illustrate " +
    "outline mention detail details following answer marks suitable examples example with"
  ).split(/\s+/),
);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\$[^$]*\$/g, " ") // drop inline math markup noise
    .replace(/[`*_#>|~^\\[\](){}]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stem(word: string): string {
  if (word.length <= 4) return word;
  return word
    .replace(/(ational|tional)$/, "tion")
    .replace(/(ization|isation)$/, "ize")
    .replace(/(iveness|fulness|ousness)$/, "")
    .replace(/(ments?|ings?|edly|ies|ied|ly|ed|es|s)$/, (m) => (m === "ies" || m === "ied" ? "y" : ""));
}

export function tokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((w) => w && !STOPWORDS.has(w))
    .map(stem);
}

function trigrams(text: string): Set<string> {
  const s = `  ${normalize(text)} `;
  const out = new Set<string>();
  for (let i = 0; i < s.length - 2; i++) out.add(s.slice(i, i + 3));
  return out;
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function termVector(toks: string[]): Map<string, number> {
  const v = new Map<string, number>();
  for (let i = 0; i < toks.length; i++) {
    v.set(toks[i], (v.get(toks[i]) ?? 0) + 1);
    if (i + 1 < toks.length) {
      const bg = `${toks[i]}_${toks[i + 1]}`;
      v.set(bg, (v.get(bg) ?? 0) + 1.5);
    }
  }
  return v;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, x] of a) {
    na += x * x;
    const y = b.get(k);
    if (y) dot += x * y;
  }
  for (const y of b.values()) nb += y * y;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export type SimilarityKind = "exact" | "near-duplicate" | "similar-wording" | "same-concept" | "distinct";

export interface SimilarityResult {
  score: number; // 0 … 1
  kind: SimilarityKind;
  wording: number;
  lexical: number;
  concept: number;
}

export interface Comparable {
  text: string;
  topic?: string | null;
  keywords?: string[];
}

export function compareQuestions(a: Comparable, b: Comparable): SimilarityResult {
  const na = normalize(a.text);
  const nb = normalize(b.text);
  if (na.length > 0 && na === nb) return { score: 1, kind: "exact", wording: 1, lexical: 1, concept: 1 };

  const ta = tokens(a.text);
  const tb = tokens(b.text);
  const wording = jaccard(trigrams(a.text), trigrams(b.text));
  const lexical = cosine(termVector(ta), termVector(tb));
  const ka = new Set([...ta, ...(a.keywords ?? []).map((k) => stem(k.toLowerCase()))]);
  const kb = new Set([...tb, ...(b.keywords ?? []).map((k) => stem(k.toLowerCase()))]);
  const sameTopic = !!a.topic && !!b.topic && a.topic === b.topic;
  const concept = Math.min(1, jaccard(ka, kb) + (sameTopic ? 0.15 : 0));

  const score = Math.min(1, 0.4 * lexical + 0.35 * wording + 0.25 * concept);
  let kind: SimilarityKind = "distinct";
  if (score >= 0.85 || wording >= 0.9) kind = "near-duplicate";
  else if (score >= 0.6 || wording >= 0.65) kind = "similar-wording";
  else if (concept >= 0.5 && sameTopic) kind = "same-concept";
  return { score: Math.round(score * 1000) / 1000, kind, wording, lexical, concept };
}

export function isDuplicate(r: SimilarityResult): boolean {
  return r.kind !== "distinct";
}

/** Group near-duplicates inside a list (O(n²); intended for a single paper or a small candidate set). */
export function findInternalDuplicates<T extends Comparable & { id: string }>(
  list: T[],
  threshold = 0.6,
): { a: T; b: T; result: SimilarityResult }[] {
  const out: { a: T; b: T; result: SimilarityResult }[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const result = compareQuestions(list[i], list[j]);
      if (result.score >= threshold || result.kind === "exact") out.push({ a: list[i], b: list[j], result });
    }
  }
  return out;
}
