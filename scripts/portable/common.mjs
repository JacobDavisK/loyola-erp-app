/**
 * Shared helpers for the portable (single-computer) setup: .env handling, child processes,
 * and a local PostgreSQL server that runs inside the launcher process so that closing the
 * launcher always stops the database cleanly.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ENV_FILE = path.join(ROOT, ".env");
export const DATA_DIR = path.join(ROOT, ".pgdata");

export const say = (msg) => console.log(`\n\x1b[1m» ${msg}\x1b[0m`);
export const fail = (msg) => {
  console.error(`\n\x1b[31m✖ ${msg}\x1b[0m\n`);
  process.exit(1);
};

/** Minimal .env parser (KEY=value, optional quotes, # comments). */
export function loadEnv() {
  if (!existsSync(ENV_FILE)) return {};
  const out = {};
  for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

export function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
    s.setTimeout(1500, () => { s.destroy(); resolve(false); });
  });
}

/** Runs a command (through the shell, so npm/npx resolve on Windows) and resolves on success. */
export function run(cmd, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, { cwd: ROOT, shell: true, stdio: "inherit", env: { ...process.env, ...env } });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`"${cmd}" failed (exit code ${code})`))));
    child.on("error", reject);
  });
}

/** pg_ctl from the bundled PostgreSQL binaries for this platform. */
function pgCtl() {
  const os = process.platform === "win32" ? "windows" : process.platform;
  const exe = path.join(ROOT, "node_modules", "@embedded-postgres", `${os}-${process.arch}`, "native", "bin", process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl");
  return existsSync(exe) ? exe : null;
}

/**
 * Starts the bundled PostgreSQL for this folder. If our own server is still running (for example
 * after the launcher window was killed), it is stopped cleanly first. pg_ctl only acts on the
 * server that owns this .pgdata folder, so a different program on the port is never touched.
 */
export async function startDb(port, password) {
  if (await portOpen(port)) {
    const ctl = pgCtl();
    if (ctl && existsSync(path.join(DATA_DIR, "postmaster.pid"))) spawnSync(ctl, ["-D", DATA_DIR, "stop", "-m", "fast"], { stdio: "ignore" });
    if (await portOpen(port)) throw new Error(`Port ${port} is used by another program (perhaps another EXAMCORE copy that is running). Close it and try again.`);
  }
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const firstRun = !existsSync(path.join(DATA_DIR, "PG_VERSION"));
  // A pid file left behind by a crash would block start-up; nothing is listening, so it is stale.
  if (!firstRun && existsSync(path.join(DATA_DIR, "postmaster.pid"))) rmSync(path.join(DATA_DIR, "postmaster.pid"));
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: "examcore",
    password,
    port,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C", "--auth=scram-sha-256"],
    onLog: () => {},
    onError: () => {},
  });
  if (firstRun) await pg.initialise();
  await pg.start();
  if (firstRun) await pg.createDatabase("examcore");
  return { firstRun, stop: () => pg.stop() };
}
