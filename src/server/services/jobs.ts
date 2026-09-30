import "server-only";
import { hostname } from "node:os";
import type { Prisma } from "@/generated/prisma/client";
import { type AuthContext, can } from "@/server/auth/current";
import { db, type Tx } from "@/server/db";
import { forbidden, notFound } from "@/server/errors";

/**
 * Background job queue backed by PostgreSQL. Long-running work (bulk imports, exports, PDF batches,
 * escalations) is enqueued inside the request's transaction and executed by `npm run worker`,
 * so HTTP requests never block on it.
 */

export interface JobContext {
  jobId: string;
  createdById: string | null;
  progress: (pct: number) => Promise<void>;
}
type JobHandler = (payload: Record<string, unknown>, ctx: JobContext) => Promise<unknown>;
const handlers = new Map<string, JobHandler>();

export function defineJob(type: string, handler: JobHandler) {
  handlers.set(type, handler);
}

export function registeredJobTypes() {
  return [...handlers.keys()].sort();
}

export async function enqueueJob(
  client: Tx | typeof db,
  job: { type: string; payload?: Record<string, unknown>; runAt?: Date; createdById?: string | null; maxAttempts?: number },
) {
  return client.job.create({
    data: {
      type: job.type,
      payload: JSON.parse(JSON.stringify(job.payload ?? {})) as Prisma.InputJsonValue,
      runAt: job.runAt ?? new Date(),
      createdById: job.createdById ?? null,
      maxAttempts: job.maxAttempts ?? 3,
    },
  });
}

const WORKER_ID = `${hostname()}:${process.pid}`;
const STALE_MS = 15 * 60_000;

/** Claim one due job (SKIP LOCKED) and run it. Returns false when the queue is empty. */
export async function runNextJob(): Promise<boolean> {
  // Release jobs whose worker died mid-run.
  await db.job.updateMany({ where: { status: "RUNNING", lockedAt: { lt: new Date(Date.now() - STALE_MS) } }, data: { status: "QUEUED", lockedAt: null, lockedBy: null } });

  const claimed = await db.$queryRaw<{ id: string; type: string; payload: Prisma.JsonValue; attempts: number; maxAttempts: number; createdById: string | null }[]>`
    UPDATE "Job" SET "status" = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${WORKER_ID}, "attempts" = "attempts" + 1
    WHERE "id" = (
      SELECT "id" FROM "Job" WHERE "status" = 'QUEUED' AND "runAt" <= now()
      ORDER BY "runAt", "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1
    )
    RETURNING "id", "type", "payload", "attempts", "maxAttempts", "createdById"`;
  const job = claimed[0];
  if (!job) return false;

  const handler = handlers.get(job.type);
  try {
    if (!handler) throw new Error(`No handler registered for job type "${job.type}"`);
    const result = await handler((job.payload ?? {}) as Record<string, unknown>, {
      jobId: job.id,
      createdById: job.createdById,
      progress: async (pct) => {
        await db.job.update({ where: { id: job.id }, data: { progress: Math.max(0, Math.min(100, Math.round(pct))) } });
      },
    });
    await db.job.update({
      where: { id: job.id },
      data: { status: "SUCCEEDED", progress: 100, finishedAt: new Date(), lockedAt: null, result: result === undefined ? undefined : (JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue), error: null },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 2000) : String(err);
    const retry = job.attempts < job.maxAttempts && !!handler;
    await db.job.update({
      where: { id: job.id },
      data: retry
        ? { status: "QUEUED", lockedAt: null, lockedBy: null, error: message, runAt: new Date(Date.now() + 2 ** job.attempts * 30_000) }
        : { status: "FAILED", lockedAt: null, finishedAt: new Date(), error: message },
    });
  }
  return true;
}

/** A user's own job (status/progress/result polling from the UI). */
export async function getJobFor(ctx: AuthContext, id: string) {
  const job = await db.job.findUnique({ where: { id } });
  if (!job || (job.createdById !== ctx.user.id && !can(ctx, "system.health"))) throw notFound("Job");
  return job;
}

export async function cancelJob(ctx: AuthContext, id: string) {
  const job = await getJobFor(ctx, id);
  if (job.status !== "QUEUED") throw forbidden("Only queued jobs can be cancelled.");
  await db.job.update({ where: { id }, data: { status: "CANCELLED", finishedAt: new Date() } });
}

export async function jobStats() {
  const groups = await db.job.groupBy({ by: ["status"], _count: { _all: true } });
  const counts = Object.fromEntries(groups.map((g) => [g.status, g._count._all])) as Partial<Record<string, number>>;
  const oldestQueued = await db.job.findFirst({ where: { status: "QUEUED", runAt: { lte: new Date() } }, orderBy: { runAt: "asc" }, select: { runAt: true } });
  return { counts, oldestQueuedAt: oldestQueued?.runAt ?? null };
}
