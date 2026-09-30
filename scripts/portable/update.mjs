/**
 * Self-update for installed copies. Releases are published as plain snapshots to a public download
 * repository; its VERSION file names the newest one. The launcher compares that with the installed
 * VERSION at start-up and while running, and moves to the new release on its own.
 * A development checkout (no VERSION file) never updates.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT, run } from "./common.mjs";

const REPO = "JacobDavisK/loyola-erp-app";
const BRANCH = "main";
const VERSION_URL = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/VERSION`;
const ARCHIVE_URL = `https://github.com/${REPO}/archive/refs/heads/${BRANCH}.zip`;

const VERSION_FILE = path.join(ROOT, "VERSION");
/** A release that failed to build here is not tried again; the next one is. */
const SKIP_FILE = path.join(ROOT, ".update-skip");
const NEW_DIR = path.join(ROOT, ".update-new");
const PREV_DIR = path.join(ROOT, ".update-prev");
/** This computer's own data and build output: never replaced by a release. */
const KEEP = new Set([".env", ".pgdata", "storage", "node_modules", ".next", ".update-skip", ".update-new", ".update-prev"]);

const read = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim() : "");

export const canUpdate = () => process.platform === "win32" && existsSync(VERSION_FILE) && !existsSync(path.join(ROOT, ".git"));

/** Returns the newest version when it differs from the installed one, or null (also when offline). */
export async function pendingUpdate() {
  if (!canUpdate()) return null;
  try {
    const r = await fetch(`${VERSION_URL}?t=${Date.now()}`, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const next = (await r.text()).trim();
    if (!/^[\w.:-]{6,80}$/.test(next) || next === read(VERSION_FILE) || next === read(SKIP_FILE)) return null;
    return { next };
  } catch {
    return null;
  }
}

/** Downloads the newest release and unpacks it into NEW_DIR. */
async function download() {
  rmSync(NEW_DIR, { recursive: true, force: true });
  mkdirSync(NEW_DIR, { recursive: true });
  const r = await fetch(ARCHIVE_URL, { signal: AbortSignal.timeout(300_000) });
  if (!r.ok) throw new Error(`download failed (${r.status})`);
  const zip = path.join(NEW_DIR, "release.zip");
  writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
  // Windows ships bsdtar, which reads zip archives. The archive has one top-level folder.
  const x = spawnSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", zip, "--strip-components=1", "-C", NEW_DIR], { stdio: "ignore", windowsHide: true });
  rmSync(zip, { force: true });
  if (x.status !== 0 || !existsSync(path.join(NEW_DIR, "package.json")) || !existsSync(path.join(NEW_DIR, "VERSION"))) throw new Error("the downloaded release is incomplete");
}

const sources = (dir) => readdirSync(dir).filter((name) => !KEEP.has(name));

/** Replaces the application's files with those in `from`, moving the current ones to `backup`. */
function swap(from, backup) {
  rmSync(backup, { recursive: true, force: true });
  mkdirSync(backup, { recursive: true });
  for (const name of sources(ROOT)) renameSync(path.join(ROOT, name), path.join(backup, name));
  for (const name of sources(from)) cpSync(path.join(from, name), path.join(ROOT, name), { recursive: true });
}

async function build(lockChanged, db, migrate = true) {
  if (lockChanged) {
    // The database runs from binaries inside node_modules, so it must be down while they are replaced.
    await db.stop();
    try {
      await run("npm ci --no-audit --no-fund");
    } finally {
      await db.start();
    }
  } else {
    await run("npx prisma generate");
  }
  if (migrate) {
    await run("npx prisma migrate deploy");
    await run("npx tsx scripts/sync-rbac.ts");
  }
  await run("npx next build");
}

/**
 * Moves to the newest release. The application must be stopped; `db` gives stop()/start() for the
 * local database. If the release cannot be built, the previous one is restored and `false` is returned.
 */
export async function applyUpdate({ next }, db) {
  try {
    await download();
  } catch (e) {
    console.error(`\nThe update could not be downloaded (${e.message}). Staying on this version.`);
    return false;
  }
  const lock = (dir) => read(path.join(dir, "package-lock.json"));
  const lockChanged = lock(ROOT) !== lock(NEW_DIR);
  swap(NEW_DIR, PREV_DIR);
  try {
    await build(lockChanged, db);
    rmSync(NEW_DIR, { recursive: true, force: true });
    rmSync(PREV_DIR, { recursive: true, force: true });
    return true;
  } catch (e) {
    console.error(`\nThe update could not be installed (${e.message}). Going back to the previous version.`);
    writeFileSync(SKIP_FILE, next);
    swap(PREV_DIR, NEW_DIR);
    await build(lockChanged, db, false);
    rmSync(NEW_DIR, { recursive: true, force: true });
    rmSync(PREV_DIR, { recursive: true, force: true });
    return false;
  }
}
