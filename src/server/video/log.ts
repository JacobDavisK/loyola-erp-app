import "server-only";

/**
 * Structured logs for the video module: one JSON line per event (meeting lifecycle, token issue, provider
 * errors, webhooks, recordings, authorisation failures), ready for any log collector. Never log tokens,
 * secrets or chat content.
 */
export function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === "test" && level === "info") return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, module: "video", event, ...fields }, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
