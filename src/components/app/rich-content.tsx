import katex from "katex";
import { Fragment } from "react";
import { parseContent, type Block, type Inline } from "@/lib/content/parse";
import type { QuestionOptionData } from "@/lib/domain/paper-types";
import { cn } from "@/lib/utils";

/**
 * Renders EXAMCORE question content. User text is emitted only as React text nodes; the single
 * dangerouslySetInnerHTML is KaTeX output generated with trust:false (no user HTML can pass through).
 */
function Math({ tex, display }: { tex: string; display?: boolean }) {
  let html: string;
  try {
    html = katex.renderToString(tex, { displayMode: !!display, throwOnError: true, strict: "ignore", trust: false, output: "html" });
  } catch {
    return (
      <span className="rounded bg-destructive/10 px-1 font-mono text-[0.85em] text-destructive" title="Equation could not be rendered">
        {tex}
      </span>
    );
  }
  return display ? <div className="my-2 overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} /> : <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case "text":
            return <Fragment key={i}>{n.v}</Fragment>;
          case "b":
            return <strong key={i}><Inlines nodes={n.c} /></strong>;
          case "i":
            return <em key={i}><Inlines nodes={n.c} /></em>;
          case "code":
            return <code key={i}>{n.v}</code>;
          case "math":
            return <Math key={i} tex={n.v} />;
          case "sub":
            return <sub key={i}>{n.v}</sub>;
          case "sup":
            return <sup key={i}>{n.v}</sup>;
        }
      })}
    </>
  );
}

function BlockView({ b, assetUrl }: { b: Block; assetUrl?: (id: string) => string }) {
  switch (b.t) {
    case "p":
      return <p><Inlines nodes={b.c} /></p>;
    case "ul":
      return <ul>{b.items.map((it, i) => <li key={i}><Inlines nodes={it} /></li>)}</ul>;
    case "ol":
      return <ol>{b.items.map((it, i) => <li key={i}><Inlines nodes={it} /></li>)}</ol>;
    case "code":
      return <pre><code>{b.v}</code></pre>;
    case "math":
      return <Math tex={b.v} display />;
    case "table":
      return (
        <table>
          <thead>
            <tr>{b.head.map((c, i) => <th key={i} scope="col"><Inlines nodes={c} /></th>)}</tr>
          </thead>
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={i}>{r.map((c, j) => <td key={j}><Inlines nodes={c} /></td>)}</tr>
            ))}
          </tbody>
        </table>
      );
    case "img":
      return assetUrl ? (
        <figure className="my-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed, private URLs */}
          <img src={assetUrl(b.assetId)} alt={b.alt || "Question figure"} className="max-h-72 max-w-full" />
          {b.alt && <figcaption className="mt-1 text-xs text-muted-foreground">{b.alt}</figcaption>}
        </figure>
      ) : (
        <div className="my-2 rounded border border-dashed px-3 py-2 text-xs text-muted-foreground">[Figure: {b.alt || b.assetId}]</div>
      );
  }
}

export function RichContent({
  body,
  options,
  className,
  assetUrl,
}: {
  body: string;
  options?: QuestionOptionData | null;
  className?: string;
  assetUrl?: (id: string) => string;
}) {
  const blocks = parseContent(body);
  return (
    <div className={cn("qc", className)}>
      {blocks.map((b, i) => (
        <BlockView key={i} b={b} assetUrl={assetUrl} />
      ))}
      {options?.choices && options.choices.length > 0 && (
        <ol style={{ listStyle: "none", paddingLeft: 0, marginTop: 6, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", columnGap: 24, rowGap: 2 }}>
          {options.choices.map((c, i) => (
            <li key={i}>
              ({c.label || String.fromCharCode(97 + i)}) <Inlines nodes={parseInlineSafe(c.text)} />
            </li>
          ))}
        </ol>
      )}
      {options?.pairs && options.pairs.length > 0 && (
        <table className="mt-2">
          <tbody>
            {options.pairs.map((p, i) => (
              <tr key={i}>
                <td>{i + 1}. <Inlines nodes={parseInlineSafe(p.left)} /></td>
                <td>{String.fromCharCode(97 + i)}. <Inlines nodes={parseInlineSafe(p.right)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function parseInlineSafe(s: string): Inline[] {
  const blocks = parseContent(s);
  return blocks[0]?.t === "p" ? blocks[0].c : [{ t: "text", v: s }];
}
