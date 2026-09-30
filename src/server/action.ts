import "server-only";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { z } from "zod";
import { isAppError } from "@/server/errors";

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string[]>; details?: unknown };

/**
 * Wrap a server action body: validates input, maps typed errors to safe messages,
 * never leaks stack traces or internal errors to the client.
 */
export async function runAction<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message };
  } catch (e) {
    if (isRedirectError(e)) throw e;
    if (e instanceof z.ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of e.issues) {
        const k = issue.path.join(".") || "_";
        (fieldErrors[k] ??= []).push(issue.message);
      }
      return { ok: false, error: "Please check the highlighted fields.", code: "VALIDATION", fieldErrors };
    }
    if (isAppError(e)) return { ok: false, error: e.message, code: e.code, details: e.details };
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") {
      return { ok: false, error: "A record with this code or name already exists.", code: "CONFLICT" };
    }
    const pgMessage = e instanceof Error ? e.message : "";
    if (pgMessage.includes("EXAMCORE:")) {
      return { ok: false, error: pgMessage.slice(pgMessage.indexOf("EXAMCORE:") + 10).split("\n")[0], code: "FORBIDDEN" };
    }
    console.error("[action] unexpected error", e);
    return { ok: false, error: "Something went wrong. Your change was not saved.", code: "INTERNAL" };
  }
}
