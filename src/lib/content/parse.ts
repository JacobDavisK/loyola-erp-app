/**
 * EXAMCORE question content format — a strict Markdown subset.
 *
 * Blocks:   paragraphs · "- " / "1. " lists · GFM pipe tables · ``` code fences ``` · $$ display math $$
 *           · images `![caption](asset:<id>)` on their own line
 * Inline:   **bold** · *italic* · `code` · $inline math$ · ~sub~ · ^sup^
 *
 * The parser produces an AST; renderers never inject raw HTML, so user content cannot execute script.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "b"; c: Inline[] }
  | { t: "i"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "math"; v: string }
  | { t: "sub"; v: string }
  | { t: "sup"; v: string };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; items: Inline[][] }
  | { t: "table"; head: Inline[][]; rows: Inline[][][] }
  | { t: "code"; lang: string; v: string }
  | { t: "math"; v: string }
  | { t: "img"; assetId: string; alt: string };

const IMG_RE = /^!\[([^\]]*)\]\(asset:([a-z0-9]+)\)$/i;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const rest = src.slice(i);
    if (ch === "\\" && i + 1 < src.length) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (rest.startsWith("**")) {
      const end = src.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: "b", c: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (ch === "*" || ch === "_") {
      const end = src.indexOf(ch, i + 1);
      if (end > i + 1 && src[i + 1] !== " ") {
        flush();
        out.push({ t: "i", c: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i) {
        flush();
        out.push({ t: "code", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "$") {
      const end = src.indexOf("$", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: "math", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "~" || ch === "^") {
      const end = src.indexOf(ch, i + 1);
      if (end > i + 1 && end - i < 20 && !src.slice(i + 1, end).includes(" ")) {
        flush();
        out.push({ t: ch === "~" ? "sub" : "sup", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

function splitRow(line: string): string[] {
  let l = line.trim();
  if (l.startsWith("|")) l = l.slice(1);
  if (l.endsWith("|")) l = l.slice(0, -1);
  return l.split("|").map((c) => c.trim());
}

const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

export function parseContent(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ t: "p", c: parseInline(para.join(" ")) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushPara();
      continue;
    }
    if (trimmed.startsWith("```")) {
      flushPara();
      const lang = trimmed.slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
      blocks.push({ t: "code", lang, v: body.join("\n") });
      continue;
    }
    if (trimmed.startsWith("$$")) {
      flushPara();
      const inlineEnd = trimmed.length > 4 && trimmed.endsWith("$$");
      if (inlineEnd) {
        blocks.push({ t: "math", v: trimmed.slice(2, -2).trim() });
        continue;
      }
      const body: string[] = [trimmed.slice(2)];
      i++;
      while (i < lines.length && !lines[i].trim().endsWith("$$")) body.push(lines[i++]);
      if (i < lines.length) body.push(lines[i].trim().slice(0, -2));
      blocks.push({ t: "math", v: body.join("\n").trim() });
      continue;
    }
    const img = trimmed.match(IMG_RE);
    if (img) {
      flushPara();
      blocks.push({ t: "img", alt: img[1], assetId: img[2] });
      continue;
    }
    if (trimmed.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      flushPara();
      const head = splitRow(trimmed).map(parseInline);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().includes("|")) rows.push(splitRow(lines[i++]).map(parseInline));
      i--;
      blocks.push({ t: "table", head, rows });
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      flushPara();
      const items: Inline[][] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) items.push(parseInline(lines[i++].trim().replace(/^[-*]\s+/, "")));
      i--;
      blocks.push({ t: "ul", items });
      continue;
    }
    if (/^\d+[.)]\s+/.test(trimmed)) {
      flushPara();
      const items: Inline[][] = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) items.push(parseInline(lines[i++].trim().replace(/^\d+[.)]\s+/, "")));
      i--;
      blocks.push({ t: "ol", items });
      continue;
    }
    para.push(trimmed);
  }
  flushPara();
  return blocks;
}

/** Plain text for search, duplicate detection and previews. */
export function toPlainText(src: string): string {
  const inl = (xs: Inline[]): string =>
    xs.map((x) => ("c" in x ? inl(x.c) : x.t === "math" ? ` ${x.v} ` : x.v)).join("");
  return parseContent(src)
    .map((b) => {
      switch (b.t) {
        case "p":
          return inl(b.c);
        case "ul":
        case "ol":
          return b.items.map(inl).join("; ");
        case "table":
          return [b.head, ...b.rows].map((r) => r.map(inl).join(" ")).join(" ");
        case "code":
        case "math":
          return b.v;
        case "img":
          return b.alt;
      }
    })
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function collectMath(src: string): string[] {
  const out: string[] = [];
  const walk = (xs: Inline[]) => xs.forEach((x) => (x.t === "math" ? out.push(x.v) : "c" in x ? walk(x.c) : null));
  for (const b of parseContent(src)) {
    if (b.t === "math") out.push(b.v);
    if (b.t === "p") walk(b.c);
    if (b.t === "ul" || b.t === "ol") b.items.forEach(walk);
    if (b.t === "table") [b.head, ...b.rows].forEach((r) => r.forEach(walk));
  }
  return out;
}

export function collectAssets(src: string): string[] {
  return parseContent(src).flatMap((b) => (b.t === "img" ? [b.assetId] : []));
}
