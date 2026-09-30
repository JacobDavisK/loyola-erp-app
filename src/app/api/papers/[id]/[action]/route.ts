import { z } from "zod";
import { NextResponse } from "next/server";
import type { PaperAction } from "@/lib/domain/workflow";
import { api, body } from "@/server/api";
import { transitionPaper } from "@/server/services/papers";

/**
 * Workflow endpoints:
 *   POST /api/papers/:id/submit      { resubmit?: boolean }
 *   POST /api/papers/:id/moderate    { decision: "start" | "approve" | "request_changes" | "reject", note? }
 *   POST /api/papers/:id/scrutinize  { decision: "pass" | "return", note? }
 *   POST /api/papers/:id/approve     { decision: "approve" | "return" | "reject", note? }
 *   POST /api/papers/:id/lock        { note? }
 *   POST /api/papers/:id/release | archive | reopen  { note? }
 */
const MAP: Record<string, (b: Record<string, unknown>) => PaperAction> = {
  submit: (b) => (b.resubmit ? "resubmit" : "submit"),
  moderate: (b) => ({ start: "start_moderation", approve: "moderation_approve", request_changes: "moderation_request_changes", reject: "moderation_reject" } as const)[z.enum(["start", "approve", "request_changes", "reject"]).parse(b.decision)],
  scrutinize: (b) => ({ pass: "scrutiny_pass", return: "scrutiny_return" } as const)[z.enum(["pass", "return"]).parse(b.decision)],
  approve: (b) => ({ approve: "approve", return: "approval_return", reject: "approval_reject" } as const)[z.enum(["approve", "return", "reject"]).parse(b.decision ?? "approve")],
  lock: () => "lock",
  release: () => "release",
  archive: () => "archive",
  reopen: () => "reopen",
};

const handler = api<{ id: string; action: string }>(async ({ req, ctx, params }) => {
  const b = z.object({ note: z.string().max(2000).optional() }).passthrough().parse(await body(req)) as Record<string, unknown> & { note?: string };
  const action = MAP[params.action](b);
  return transitionPaper(ctx, params.id, action, { note: b.note });
});

export async function POST(req: Parameters<typeof handler>[0], route: { params: Promise<{ id: string; action: string }> }) {
  const { action } = await route.params;
  if (!(action in MAP)) return NextResponse.json({ error: "Unknown workflow action." }, { status: 404 });
  return handler(req, route);
}
