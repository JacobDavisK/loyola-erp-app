import "server-only";
import ExcelJS from "exceljs";
import { escapeHtml, renderHtmlPdf } from "@/server/pdf/render";
import type { Report } from "@/server/services/reports";
import { BRAND } from "@/lib/brand";

/** Neutralise spreadsheet formula injection (cells starting with = + - @ tab CR). */
function safeCell(v: string | number): string | number {
  if (typeof v === "number") return v;
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export function reportToCsv(r: Report): string {
  const esc = (v: string | number) => {
    const s = String(safeCell(v));
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [esc(r.title), esc(r.subtitle), ""];
  for (const s of r.summary) lines.push(`${esc(s.label)},${esc(s.value)}`);
  for (const t of r.tables) {
    lines.push("", esc(t.title), t.columns.map((c) => esc(c.label)).join(","));
    for (const row of t.rows) lines.push(t.columns.map((c) => esc(row[c.key] ?? "")).join(","));
  }
  return "﻿" + lines.join("\r\n");
}

export async function reportToXlsx(r: Report, author: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = `${BRAND.name} — ${author}`;
  wb.created = new Date();
  const summary = wb.addWorksheet("Summary");
  summary.addRow([r.title]).font = { bold: true, size: 14 };
  summary.addRow([r.subtitle]);
  summary.addRow([`Generated ${new Date().toLocaleString("en-GB")} by ${author}`]);
  summary.addRow([]);
  for (const s of r.summary) summary.addRow([s.label, safeCell(s.value)]);
  summary.getColumn(1).width = 32;
  summary.getColumn(2).width = 18;
  const used = new Set<string>();
  for (const t of r.tables) {
    let name = t.title.replace(/[\\/?*[\]:]/g, " ").slice(0, 28);
    while (used.has(name)) name = `${name.slice(0, 26)} 2`;
    used.add(name);
    const ws = wb.addWorksheet(name);
    ws.columns = t.columns.map((c) => ({ header: c.label, key: c.key, width: Math.min(60, Math.max(12, c.label.length + 4, ...t.rows.map((row) => String(row[c.key] ?? "").length + 2))) }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF1F6" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    for (const row of t.rows) ws.addRow(Object.fromEntries(t.columns.map((c) => [c.key, safeCell(row[c.key] ?? "")])));
    t.columns.forEach((c, i) => {
      if (c.align === "right") ws.getColumn(i + 1).alignment = { horizontal: "right" };
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function reportToPdf(r: Report, institution: string, author: string): Promise<Buffer> {
  const tables = r.tables
    .map(
      (t) => `<h2>${escapeHtml(t.title)}</h2>
<table><thead><tr>${t.columns.map((c) => `<th class="${c.align === "right" ? "r" : ""}">${escapeHtml(c.label)}</th>`).join("")}</tr></thead>
<tbody>${t.rows.length ? t.rows.map((row) => `<tr>${t.columns.map((c) => `<td class="${c.align === "right" ? "r" : ""}">${escapeHtml(String(row[c.key] ?? ""))}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${t.columns.length}" class="muted">No records</td></tr>`}</tbody></table>`,
    )
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#1a1d24;font-size:10.5px;margin:0}
    header{border-bottom:2px solid #1d3f9a;padding-bottom:8px;margin-bottom:14px}
    .inst{font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.08em}
    h1{font-size:18px;margin:4px 0 2px} .sub{color:#555}
    .summary{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 6px}
    .card{border:1px solid #dde1ea;border-radius:6px;padding:6px 10px;min-width:110px}
    .card b{display:block;font-size:15px} .card span{color:#555;font-size:9.5px}
    h2{font-size:12px;margin:16px 0 6px}
    table{width:100%;border-collapse:collapse} th,td{border-bottom:1px solid #e6e8ee;padding:4px 6px;text-align:left;vertical-align:top}
    th{background:#f2f4f8;font-weight:600} .r{text-align:right} .muted{color:#888} tr{break-inside:avoid}
  </style></head><body>
  <header><div class="inst">${escapeHtml(institution)} · Office of the Controller of Examinations</div><h1>${escapeHtml(r.title)}</h1><div class="sub">${escapeHtml(r.subtitle)} · generated ${escapeHtml(new Date().toLocaleString("en-GB"))} by ${escapeHtml(author)}</div></header>
  <div class="summary">${r.summary.map((s) => `<div class="card"><b>${escapeHtml(String(s.value))}</b><span>${escapeHtml(s.label)}</span></div>`).join("")}</div>
  ${tables}</body></html>`;
  return renderHtmlPdf(html, { footerLabel: `${BRAND.name} · ${r.title} · Confidential`, landscape: r.tables.some((t) => t.columns.length > 5) });
}
