import "server-only";
import { access, constants } from "node:fs/promises";
import path from "node:path";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { eventStats } from "@/server/services/events";
import { jobStats } from "@/server/services/jobs";

export const WORKER_HEARTBEAT_KEY = "_worker.heartbeat";

export interface HealthCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/** Operational health for administrators and the /api/health probe (no secrets are included). */
export async function systemHealth() {
  const checks: HealthCheck[] = [];
  const t0 = performance.now();
  let dbOk = false;
  try {
    await db.$queryRaw`SELECT 1`;
    dbOk = true;
    checks.push({ name: "Database", ok: true, detail: `Reachable in ${Math.round(performance.now() - t0)} ms` });
  } catch (e) {
    checks.push({ name: "Database", ok: false, detail: e instanceof Error ? e.message.split("\n")[0] : "Unreachable" });
  }

  let migrations = { applied: 0, failed: 0, latest: null as string | null };
  if (dbOk) {
    const rows = await db.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`
      SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at`;
    migrations = { applied: rows.filter((r) => r.finished_at && !r.rolled_back_at).length, failed: rows.filter((r) => !r.finished_at && !r.rolled_back_at).length, latest: rows.at(-1)?.migration_name ?? null };
    checks.push({ name: "Migrations", ok: migrations.failed === 0, detail: `${migrations.applied} applied${migrations.failed ? `, ${migrations.failed} failed` : ""}; latest ${migrations.latest}` });
  }

  try {
    const dir = path.resolve(env.STORAGE_DIR);
    await access(dir, constants.W_OK);
    checks.push({ name: "File storage", ok: true, detail: `${env.STORAGE_DRIVER} driver, writable` });
  } catch {
    checks.push({ name: "File storage", ok: false, detail: `${env.STORAGE_DRIVER} driver: storage directory is not writable or missing` });
  }

  const [events, jobs, heartbeat, outbox] = dbOk
    ? await Promise.all([eventStats(), jobStats(), db.systemSetting.findUnique({ where: { key: WORKER_HEARTBEAT_KEY } }), db.emailOutbox.count({ where: { status: "QUEUED" } })])
    : [null, null, null, 0];
  const beatAt = heartbeat ? new Date((heartbeat.value as { at: string }).at) : null;
  const workerOk = !!beatAt && Date.now() - beatAt.getTime() < 5 * 60_000;
  checks.push({
    name: "Background worker",
    ok: workerOk,
    detail: beatAt ? `Last heartbeat ${Math.round((Date.now() - beatAt.getTime()) / 1000)} s ago` : "No heartbeat recorded — start it with `npm run worker`",
  });
  if (events) checks.push({ name: "Domain events", ok: events.failed === 0, detail: `${events.pending} pending, ${events.failed} failed after retries` });
  if (jobs) checks.push({ name: "Job queue", ok: !jobs.counts.FAILED, detail: `${jobs.counts.QUEUED ?? 0} queued, ${jobs.counts.RUNNING ?? 0} running, ${jobs.counts.FAILED ?? 0} failed` });
  checks.push({
    name: "E-mail delivery",
    ok: env.EMAIL_DRIVER !== "outbox" || env.NODE_ENV !== "production",
    detail: env.EMAIL_DRIVER === "outbox" ? `Outbox driver — ${outbox} message(s) stored, not delivered. Configure a provider adapter for production.` : env.EMAIL_DRIVER,
  });

  return {
    ok: checks.every((c) => c.ok || c.name === "Background worker" || c.name === "E-mail delivery"),
    checks,
    runtime: { node: process.version, env: env.NODE_ENV, uptimeSeconds: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1_048_576) },
    migrations,
  };
}
