/**
 * Starts the application on this computer: local database + production server on http://localhost:3100.
 * Installed copies also keep themselves up to date (see update.mjs).
 * Press Ctrl+C (or close the window) to stop everything.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { ENV_FILE, ROOT, fail, loadEnv, portOpen, say, startDb } from "./common.mjs";
import { applyUpdate, canUpdate, pendingUpdate } from "./update.mjs";

const PORT = 3100;
const URL = `http://localhost:${PORT}`;
const UPDATE_CHECK_MS = 15 * 60_000;

if (!existsSync(ENV_FILE) || !existsSync(path.join(ROOT, ".next", "BUILD_ID"))) fail("The application is not set up yet. Run the installer (or setup.bat) first.");
if (await portOpen(PORT)) fail(`Port ${PORT} is already in use. The application is probably already running in another window.`);

const cfg = loadEnv();
Object.assign(process.env, cfg);
const pgPort = Number(cfg.LOCAL_PG_PORT ?? 54329);

say("Starting the local database");
let pg = await startDb(pgPort, cfg.LOCAL_PG_PASSWORD).catch((e) => fail(`The database could not start: ${e.message}`));
const db = {
  stop: () => pg.stop(),
  start: async () => {
    pg = await startDb(pgPort, cfg.LOCAL_PG_PASSWORD);
  },
};

let app = null;
let stopping = false;
let updating = false;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  console.log("\nStopping…");
  if (app && app.exitCode === null) app.kill();
  await pg.stop().catch(() => {});
  process.exit(code);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) process.on(sig, () => stop(0));

function startApp() {
  const child = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  });
  child.on("exit", (code) => {
    if (app === child && !updating) stop(code ?? 0);
  });
  app = child;
}

async function stopApp() {
  if (!app || app.exitCode !== null) return;
  const gone = new Promise((r) => app.once("exit", r));
  app.kill();
  await gone;
}

async function waitUntilUp() {
  for (let i = 0; i < 90 && !stopping; i++) {
    try {
      if ((await fetch(`${URL}/api/health`)).ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** Installs a newer release if there is one. The application is stopped while this runs. */
async function update() {
  if (updating || stopping) return;
  const pending = await pendingUpdate();
  if (!pending || updating || stopping) return;
  updating = true;
  try {
    say("A new version is available. Updating (a few minutes); the application restarts on its own");
    await stopApp();
    const ok = await applyUpdate(pending, db);
    startApp();
    if (await waitUntilUp()) console.log(`\n\x1b[32m✔ ${ok ? "Updated" : "Still on the previous version"}; running at ${URL}\x1b[0m\n`);
  } catch (e) {
    fail(`The application could not be restarted after an update: ${e.message}`);
  } finally {
    updating = false;
  }
}

if (canUpdate()) {
  say("Checking for updates");
  const pending = await pendingUpdate();
  if (pending) {
    say("A new version is available. Updating (a few minutes)");
    await applyUpdate(pending, db).catch((e) => fail(`The update failed and the previous version could not be restored: ${e.message}`));
  } else {
    console.log("  Up to date.");
  }
  setInterval(update, UPDATE_CHECK_MS);
}

say(`Starting on ${URL}`);
startApp();
if (await waitUntilUp()) {
  console.log(`\n\x1b[32m✔ Running at ${URL}\x1b[0m  — keep this window open; press Ctrl+C to stop.\n`);
  if (!process.env.EXAMCORE_NO_BROWSER) {
    const opener = process.platform === "win32" ? ["cmd", ["/c", "start", "", URL]] : process.platform === "darwin" ? ["open", [URL]] : ["xdg-open", [URL]];
    spawn(opener[0], opener[1], { stdio: "ignore", detached: true }).unref();
  }
}
