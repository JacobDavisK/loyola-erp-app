import "server-only";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import type { Browser } from "playwright-core";
import { PaperDocument, WatermarkOverlay, type PaperTemplateData } from "@/components/paper/paper-document";
import { collectAssets } from "@/lib/content/parse";
import type { PaperSnapshot } from "@/lib/domain/paper-types";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { storage } from "@/server/storage";

/**
 * PDF engine: server-renders the same <PaperDocument> used by the on-screen preview and prints it
 * with headless Chromium (A4, repeating header/footer, page x of y, per-page watermark).
 * Replaceable: implement `renderPaperPdf` with another engine if required.
 */

let browserPromise: Promise<Browser> | null = null;
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import("playwright-core");
      return chromium.launch({ headless: true, executablePath: env.CHROMIUM_PATH || undefined, args: ["--disable-gpu", "--no-first-run"] });
    })().catch((e) => {
      browserPromise = null;
      throw e;
    });
  }
  const b = await browserPromise;
  if (!b.isConnected()) {
    browserPromise = null;
    return getBrowser();
  }
  return b;
}

const PRINT_CSS = `
  @page { size: A4; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .qc p { margin: 0 0 4px; }
  .qc ul { list-style: disc; margin: 2px 0 4px 20px; padding: 0; }
  .qc ol { list-style: decimal; margin: 2px 0 4px 20px; padding: 0; }
  .qc table { border-collapse: collapse; margin: 6px 0; font-size: 0.95em; }
  .qc th, .qc td { border: 1px solid #555; padding: 2px 8px; text-align: left; }
  .qc th { background: #eee; }
  .qc pre { background: #f4f4f4; padding: 6px 8px; font-family: Consolas, "Courier New", monospace; font-size: 0.85em; white-space: pre-wrap; margin: 4px 0; }
  .qc code { font-family: Consolas, "Courier New", monospace; font-size: 0.9em; }
  .qc figure { margin: 6px 0; }
  .qc img { max-width: 100%; max-height: 70mm; }
  .qc ol.grid { list-style: none; margin-left: 0; display: grid; grid-template-columns: 1fr 1fr; column-gap: 24px; }
  .watermark-page { position: fixed; inset: 0; z-index: 0; pointer-events: none; }
  .content { position: relative; z-index: 1; }
  tr { break-inside: avoid; }
`;

async function dataUri(assetId: string): Promise<string | null> {
  const a = await db.fileAsset.findFirst({ where: { id: assetId, deletedAt: null } });
  if (!a) return null;
  const buf = await storage.get(a.storageKey);
  return `data:${a.mimeType};base64,${buf.toString("base64")}`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function renderPaperHtml(opts: {
  snapshot: PaperSnapshot;
  template: PaperTemplateData;
  watermarks: { text: string; opacity: number; angle: number }[];
  logoAssetId?: string | null;
}): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const assetIds = [...new Set(opts.snapshot.sections.flatMap((s) => s.items.flatMap((i) => collectAssets(i.body))))];
  const assets = new Map<string, string>();
  for (const id of assetIds) {
    const uri = await dataUri(id);
    if (uri) assets.set(id, uri);
  }
  const logo = opts.logoAssetId ? await dataUri(opts.logoAssetId) : null;
  const body = renderToStaticMarkup(
    createElement(
      "div",
      null,
      opts.watermarks.length
        ? createElement("div", { key: "w", className: "watermark-page" }, createElement(WatermarkOverlay, { texts: opts.watermarks.map((w) => w.text), opacity: Math.max(...opts.watermarks.map((w) => w.opacity)), angle: opts.watermarks[0].angle }))
        : null,
      createElement("div", { key: "c", className: "content" }, createElement(PaperDocument, { snapshot: opts.snapshot, template: opts.template, logoUrl: logo, assetUrl: (id: string) => assets.get(id) ?? "" })),
    ),
  );
  const katexCss = pathToFileURL(path.join(/*turbopackIgnore: true*/ process.cwd(), "node_modules", "katex", "dist", "katex.min.css")).href;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(opts.snapshot.paper.code)}</title>
<link rel="stylesheet" href="${katexCss}"><style>${PRINT_CSS}</style></head><body>${body}</body></html>`;
}

export async function renderPaperPdf(opts: Parameters<typeof renderPaperHtml>[0] & { footerLabel: string }): Promise<Buffer> {
  const html = await renderPaperHtml(opts);
  const dir = await mkdtemp(path.join(os.tmpdir(), "examcore-pdf-"));
  const file = path.join(dir, "paper.html");
  await writeFile(file, html, "utf8");
  const browser = await getBrowser();
  const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
  try {
    const page = await context.newPage();
    await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
    const m = `${opts.template.marginMm}mm`;
    const footer = `<div style="width:100%;font-family:Arial,sans-serif;font-size:8px;color:#444;padding:0 ${m};display:flex;justify-content:space-between;">
      <span>${escapeHtml(opts.footerLabel)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<div style="width:100%;font-family:Arial,sans-serif;font-size:7px;color:#666;text-align:right;padding:0 ${m};">${escapeHtml(opts.snapshot.paper.code)}</div>`,
      footerTemplate: footer,
      margin: { top: m, bottom: `${opts.template.marginMm + 6}mm`, left: m, right: m },
    });
    return Buffer.from(pdf);
  } finally {
    await context.close();
    await rm(dir, { recursive: true, force: true });
  }
}

/** Generic HTML → A4 PDF (reports). The HTML must be self-contained (no external resources). */
export async function renderHtmlPdf(html: string, opts: { landscape?: boolean; footerLabel: string }): Promise<Buffer> {
  const browser = await getBrowser();
  const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      landscape: opts.landscape,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: `<div style="width:100%;font-family:Arial,sans-serif;font-size:8px;color:#555;padding:0 14mm;display:flex;justify-content:space-between;"><span>${escapeHtml(opts.footerLabel)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
      margin: { top: "14mm", bottom: "18mm", left: "14mm", right: "14mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await context.close();
  }
}

export { escapeHtml };
