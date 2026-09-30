import "server-only";
import { type AuthContext } from "@/server/auth/current";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { AppError, forbidden, rateLimited } from "@/server/errors";
import { sha256 } from "@/server/security/crypto";
import { getSetting } from "@/server/services/settings";

/**
 * AI gateway. Every model call in the platform goes through `runAi`, which:
 *  - refuses when no provider is configured (nothing is ever simulated), when the institution has switched AI off,
 *    or when the feature is disabled;
 *  - enforces a per-user daily request limit;
 *  - redacts obvious personal identifiers (e-mails, phone numbers, student/employee numbers) from user text;
 *  - logs usage (hash of the redacted prompt, token counts, latency, outcome) — never the prompt or the answer.
 * Features send the model schemas and the user's own words, never records from the database.
 */

export interface AiMessage { role: "user" | "assistant"; content: string }
export interface AiCompletion { text: string; inputTokens: number; outputTokens: number }
export interface AiProvider {
  name: string;
  model: string;
  complete(input: { system: string; messages: AiMessage[]; maxTokens: number; temperature?: number }): Promise<AiCompletion>;
}

/** Anthropic Messages API over HTTPS (no SDK dependency). */
export class AnthropicProvider implements AiProvider {
  name = "anthropic";
  constructor(private readonly apiKey: string, readonly model: string, private readonly baseUrl: string, private readonly fetchImpl: typeof fetch = fetch) {}
  async complete(input: { system: string; messages: AiMessage[]; maxTokens: number; temperature?: number }): Promise<AiCompletion> {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: this.model, max_tokens: input.maxTokens, temperature: input.temperature ?? 0.2, system: input.system, messages: input.messages }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new AppError(`The AI service returned an error (${res.status}).`, "AI_UPSTREAM", 502, detail.slice(0, 300));
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    const text = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
    return { text, inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 };
  }
}

let override: AiProvider | null | undefined;
/** Tests inject a provider; production reads the environment. */
export function setAiProvider(p: AiProvider | null | undefined) {
  override = p;
}

export function aiProvider(): AiProvider | null {
  if (override !== undefined) return override;
  if (env.AI_PROVIDER === "anthropic" && env.ANTHROPIC_API_KEY) return new AnthropicProvider(env.ANTHROPIC_API_KEY, env.AI_MODEL, env.AI_BASE_URL);
  return null;
}

export type AiFeature = "reportAssistant" | "feedbackDrafts" | "announcementDrafts";

export async function aiStatus() {
  const p = aiProvider();
  const s = await getSetting("ai");
  return { configured: !!p, provider: p?.name ?? null, model: p?.model ?? null, enabled: s.enabled, features: { reportAssistant: s.reportAssistant, feedbackDrafts: s.feedbackDrafts, announcementDrafts: s.announcementDrafts }, dailyRequestsPerUser: s.dailyRequestsPerUser };
}

/** Remove common personal identifiers from free text before it leaves the platform. */
export function redact(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/(\+?\d[\d\s-]{8,}\d)/g, "[phone]")
    .replace(/\b\d{2}[A-Z]{2,6}\d{3,5}\b/g, "[student-no]")
    .replace(/\bEMP\d{3,}\b/gi, "[employee-no]")
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, "[tax-id]");
}

export async function runAi(ctx: AuthContext, feature: AiFeature, input: { system: string; user: string; maxTokens?: number; temperature?: number }): Promise<string> {
  const provider = aiProvider();
  if (!provider) throw new AppError("AI assistance is not configured on this installation. An administrator can enable it by setting AI_PROVIDER=anthropic and ANTHROPIC_API_KEY.", "AI_NOT_CONFIGURED", 503);
  const s = await getSetting("ai");
  if (!s.enabled || !s[feature]) throw forbidden("This AI feature is switched off by the institution.");
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const used = await db.aiRequest.count({ where: { userId: ctx.user.id, createdAt: { gte: since } } });
  if (used >= s.dailyRequestsPerUser) throw rateLimited(`You have used today's ${s.dailyRequestsPerUser} AI requests.`);
  const userText = redact(input.user).slice(0, 8000);
  const started = Date.now();
  const log = (status: "OK" | "ERROR" | "REFUSED", usage?: AiCompletion, error?: string) =>
    db.aiRequest.create({ data: { userId: ctx.user.id, feature, provider: provider.name, model: provider.model, promptHash: sha256(`${input.system}\n${userText}`), inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0, latencyMs: Date.now() - started, status, error: error?.slice(0, 300) ?? null } });
  try {
    const out = await provider.complete({ system: input.system, messages: [{ role: "user", content: userText }], maxTokens: input.maxTokens ?? 800, temperature: input.temperature });
    await log("OK", out);
    return out.text;
  } catch (e) {
    await log("ERROR", undefined, e instanceof Error ? e.message : String(e));
    if (e instanceof AppError) throw e;
    throw new AppError("The AI service could not be reached. Try again later.", "AI_UPSTREAM", 502);
  }
}

/** First JSON object in a model reply (models sometimes wrap JSON in prose or code fences). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AppError("The AI reply did not contain the expected structure.", "AI_FORMAT", 422);
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AppError("The AI reply could not be read. Try rephrasing.", "AI_FORMAT", 422);
  }
}
