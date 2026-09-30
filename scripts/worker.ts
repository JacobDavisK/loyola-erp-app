/**
 * Background worker: dispatches domain events, runs queued jobs and periodic maintenance.
 *   npm run worker            run continuously (Ctrl+C to stop)
 *   npm run worker -- --once  drain the queues once and exit (cron / Task Scheduler friendly)
 * Uses the react-server export condition so server-only modules load outside Next.js.
 */
import "dotenv/config";
import { db } from "@/server/db";
import "@/server/jobs";
import { processEvents } from "@/server/services/events";
import { enqueueJob, runNextJob } from "@/server/services/jobs";
import { WORKER_HEARTBEAT_KEY } from "@/server/services/system";

const once = process.argv.includes("--once");
const POLL_MS = 3_000;
const PERIODIC: { type: string; everyMs: number }[] = [
  { type: "workflow.escalate", everyMs: 15 * 60_000 },
  { type: "reminders.deadlines", everyMs: 12 * 3_600_000 },
  { type: "announcements.dispatch", everyMs: 5 * 60_000 },
  { type: "admissions.expireOffers", everyMs: 60 * 60_000 },
  { type: "library.reminders", everyMs: 24 * 3_600_000 },
];
let stopping = false;

async function heartbeat() {
  const value = { at: new Date().toISOString(), pid: process.pid };
  await db.systemSetting.upsert({ where: { key: WORKER_HEARTBEAT_KEY }, create: { key: WORKER_HEARTBEAT_KEY, value }, update: { value } });
}

/** Enqueue periodic jobs when the previous run of that type is older than its interval. */
async function schedulePeriodic() {
  for (const p of PERIODIC) {
    const last = await db.job.findFirst({ where: { type: p.type }, orderBy: { createdAt: "desc" }, select: { createdAt: true, status: true } });
    if (last && (last.status === "QUEUED" || last.status === "RUNNING")) continue;
    if (!last || Date.now() - last.createdAt.getTime() >= p.everyMs) await enqueueJob(db, { type: p.type, maxAttempts: 1 });
  }
}

async function drain() {
  let work = 0;
  work += await processEvents(100);
  for (let i = 0; i < 20 && (await runNextJob()); i++) work++;
  return work;
}

async function main() {
  console.log(`[worker] started (pid ${process.pid})${once ? " — single pass" : ""}`);
  do {
    try {
      await heartbeat();
      await schedulePeriodic();
      const n = await drain();
      if (n) console.log(`[worker] processed ${n} item(s)`);
    } catch (e) {
      console.error("[worker] cycle failed", e);
    }
    if (!once) await new Promise((r) => setTimeout(r, POLL_MS));
  } while (!once && !stopping);
  await db.$disconnect();
}

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });
main().then(() => process.exit(0));
