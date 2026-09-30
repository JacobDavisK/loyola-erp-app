import { RichContent } from "@/components/app/rich-content";
import { paperMarks, sectionMarks } from "@/lib/domain/blueprint";
import { BLOOM_K, formatDuration } from "@/lib/domain/labels";
import type { PaperSnapshot } from "@/lib/domain/paper-types";

export interface PaperTemplateData {
  headerTitle: string | null;
  headerSubtitle: string | null;
  instructions: string | null;
  footerText: string | null;
  showRegNoBoxes: boolean;
  showLogo: boolean;
  fontFamily: string;
  fontSizePt: number;
  marginMm: number;
}

export const DEFAULT_TEMPLATE: PaperTemplateData = {
  headerTitle: null,
  headerSubtitle: null,
  instructions: null,
  footerText: "Confidential",
  showRegNoBoxes: true,
  showLogo: true,
  fontFamily: "Times New Roman",
  fontSizePt: 12,
  marginMm: 18,
};

/**
 * University question-paper layout (A4). Rendered identically in the on-screen preview and,
 * via server-side HTML, by the Chromium PDF engine, so preview and printout match.
 */
export function PaperDocument({
  snapshot,
  template,
  logoUrl,
  showOutcomes = true,
  assetUrl,
}: {
  snapshot: PaperSnapshot;
  template: PaperTemplateData;
  logoUrl?: string | null;
  showOutcomes?: boolean;
  assetUrl?: (id: string) => string;
}) {
  const { exam, paper, sections } = snapshot;
  const total = paperMarks(sections);
  let n = 0;
  const generalInstructions = (paper.instructions || template.instructions || "").split("\n").map((s) => s.trim()).filter(Boolean);
  return (
    <article
      className="paper-doc text-black"
      style={{ fontFamily: `"${template.fontFamily}", "Times New Roman", Tinos, serif`, fontSize: `${template.fontSizePt}pt`, lineHeight: 1.45 }}
    >
      <header>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", fontSize: "0.8em" }}>
          <div>
            <div><b>Paper code:</b> {paper.code}</div>
            <div>Set {paper.setLabel}</div>
          </div>
          {template.showRegNoBoxes && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span>Register No.</span>
              <span style={{ display: "inline-flex" }}>
                {Array.from({ length: 10 }).map((_, i) => (
                  <span key={i} style={{ width: 18, height: 20, border: "1px solid #000", marginLeft: i ? -1 : 0, display: "inline-block" }} />
                ))}
              </span>
            </div>
          )}
        </div>

        <div style={{ textAlign: "center", marginTop: 14 }}>
          {template.showLogo && logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" style={{ height: 56, margin: "0 auto 6px" }} />
          )}
          <div style={{ fontSize: "1.35em", fontWeight: 700, letterSpacing: "0.04em" }}>{(template.headerTitle || exam.institutionName).toUpperCase()}</div>
          {(template.headerSubtitle || exam.institutionTagline) && <div style={{ fontSize: "0.9em" }}>{template.headerSubtitle || exam.institutionTagline}</div>}
          <div style={{ marginTop: 8, fontWeight: 700 }}>{exam.sessionName.toUpperCase()}</div>
          <div style={{ fontSize: "0.92em" }}>{exam.examTypeLabel} · {exam.programName} · {exam.semesterName} · {exam.regulationCode}</div>
          <div style={{ marginTop: 8, fontWeight: 700, fontSize: "1.08em" }}>
            {exam.courseCode} — {exam.courseTitle.toUpperCase()}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, paddingBottom: 6, borderBottom: "1.5px solid #000", fontWeight: 700 }}>
          <span>Time: {formatDuration(exam.durationMinutes)}</span>
          <span>Maximum: {exam.maxMarks} Marks</span>
        </div>

        {generalInstructions.length > 0 && (
          <div style={{ marginTop: 8, fontSize: "0.88em" }}>
            <b>Instructions to candidates:</b>
            <ol style={{ margin: "2px 0 0 18px", listStyle: "decimal" }}>
              {generalInstructions.map((l, i) => <li key={i}>{l}</li>)}
            </ol>
          </div>
        )}
      </header>

      {sections.map((s) => {
        const marks = sectionMarks(s);
        const each = s.marksPerQuestion ?? (s.items[0]?.marks ?? 0);
        const count = s.attemptCount ?? s.items.length;
        return (
          <section key={s.id} style={{ marginTop: 16 }}>
            <div style={{ textAlign: "center", fontWeight: 700, breakAfter: "avoid" }}>
              SECTION – {s.label}
              {each > 0 && <span> ({count} × {each} = {marks} Marks)</span>}
            </div>
            <div style={{ textAlign: "center", fontStyle: "italic", fontSize: "0.9em" }}>
              {s.instructions || s.title}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
              <colgroup>
                <col style={{ width: "2.6em" }} />
                <col />
                {showOutcomes && <col style={{ width: "3.2em" }} />}
                {showOutcomes && <col style={{ width: "2.4em" }} />}
                <col style={{ width: "2.6em" }} />
              </colgroup>
              <tbody>
                {s.items.map((it) => {
                  n++;
                  return (
                    <tr key={it.itemId} style={{ verticalAlign: "top", breakInside: "avoid" }}>
                      <td style={{ padding: "4px 0", fontWeight: 700 }}>{n}.</td>
                      <td style={{ padding: "4px 8px 4px 0" }}>
                        <RichContent body={it.body} options={it.options} assetUrl={assetUrl} />
                      </td>
                      {showOutcomes && <td style={{ padding: "4px 0", textAlign: "center", fontSize: "0.8em" }}>{it.outcomeCode ?? ""}</td>}
                      {showOutcomes && <td style={{ padding: "4px 0", textAlign: "center", fontSize: "0.8em" }}>{BLOOM_K[it.bloom]}</td>}
                      <td style={{ padding: "4px 0", textAlign: "right", fontWeight: 700 }}>({it.marks})</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}

      <div style={{ marginTop: 18, textAlign: "center", fontSize: "0.85em" }}>
        {total === exam.maxMarks ? "*******" : `— Total ${total} marks —`}
      </div>
      {showOutcomes && (
        <div style={{ marginTop: 10, fontSize: "0.72em", color: "#333" }}>
          CO — Course outcome; K1 Remember · K2 Understand · K3 Apply · K4 Analyse · K5 Evaluate · K6 Create.
        </div>
      )}
    </article>
  );
}

/** Diagonal repeating watermark overlay (screen and print). Multiple texts alternate line by line. */
export function WatermarkOverlay({ text, texts, opacity = 0.08, angle = -30 }: { text?: string; texts?: string[]; opacity?: number; angle?: number }) {
  const lines = texts?.length ? texts : [text ?? ""];
  const rows = Array.from({ length: 16 });
  return (
    <div aria-hidden className="watermark-layer" style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 5 }}>
      <div style={{ position: "absolute", inset: "-50%", transform: `rotate(${angle}deg)`, display: "flex", flexDirection: "column", justifyContent: "space-around" }}>
        {rows.map((_, i) => (
          <div key={i} style={{ whiteSpace: "nowrap", fontFamily: "Arial, sans-serif", fontSize: 15, fontWeight: 700, letterSpacing: "0.1em", color: `rgba(0,0,0,${opacity})`, marginLeft: i % 2 ? 0 : -160 }}>
            {`${lines[i % lines.length]}        `.repeat(6)}
          </div>
        ))}
      </div>
    </div>
  );
}
