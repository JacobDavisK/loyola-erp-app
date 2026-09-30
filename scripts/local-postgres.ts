/**
 * Development-only PostgreSQL server.
 * Runs real PostgreSQL binaries (via embedded-postgres) with data stored in ./.pgdata.
 * In production, point DATABASE_URL at a managed PostgreSQL instance instead.
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

const port = Number(process.env.LOCAL_PG_PORT ?? 54329);
const dataDir = path.resolve(process.cwd(), ".pgdata");
const firstRun = !existsSync(path.join(dataDir, "PG_VERSION"));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "examcore",
  password: process.env.LOCAL_PG_PASSWORD ?? "examcore_dev",
  port,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C", "--auth=scram-sha-256"],
  onLog: () => {},
});

async function main() {
  if (firstRun) await pg.initialise();
  await pg.start();
  if (firstRun) await pg.createDatabase("examcore");
  console.log(`[local-postgres] ready on postgresql://localhost:${port}/examcore`);
}

async function shutdown() {
  console.log("[local-postgres] stopping…");
  await pg.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
main().catch(async (err) => {
  console.error(err);
  await pg.stop().catch(() => {});
  process.exit(1);
});
