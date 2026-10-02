/**
 * One-time setup for running EXAMCORE on a single computer with demo data.
 * Safe to run again: existing configuration and data are kept.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, ENV_FILE, ROOT, fail, loadEnv, run, say, startDb } from "./common.mjs";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 20 || (major === 20 && minor < 9)) fail(`Node.js 20.9 or newer is required (found ${process.versions.node}). Install the LTS version from https://nodejs.org.`);

console.log("\nSetup — this can take 10–30 minutes the first time and needs an internet connection.");

// 1. Configuration with fresh secrets for this computer
function findBrowser() {
  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
          "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
        ]
      : process.platform === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];
  return candidates.find((p) => p && existsSync(p)) ?? "";
}

if (!existsSync(ENV_FILE)) {
  if (existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
    fail("A database folder (.pgdata) exists but its configuration (.env) is missing. Delete the .pgdata folder to start fresh, then run setup again.");
  }
  say("Creating configuration (.env) with new secret keys");
  const pgPassword = randomBytes(18).toString("base64url");
  const browser = findBrowser();
  let env = readFileSync(path.join(ROOT, ".env.example"), "utf8");
  const set = (key, value) => {
    const re = new RegExp(`^${key}=.*$`, "m");
    env = re.test(env) ? env.replace(re, `${key}=${value}`) : `${env}\n${key}=${value}\n`;
  };
  set("EXAMCORE_DEMO_MODE", "true");
  set("DATABASE_URL", `"postgresql://examcore:${pgPassword}@localhost:54329/examcore"`);
  set("LOCAL_PG_PASSWORD", pgPassword);
  set("APP_SECRET", `"${randomBytes(32).toString("base64url")}"`);
  set("DATA_ENCRYPTION_KEY", `"${randomBytes(32).toString("base64")}"`);
  set("APP_URL", `"http://localhost:3100"`);
  set("CHROMIUM_PATH", browser ? `"${browser}"` : "");
  writeFileSync(ENV_FILE, env);
  console.log(browser ? `  PDF engine: ${browser}` : "  No Chrome or Edge found; a private copy of Chromium will be downloaded.");
} else {
  say("Keeping the existing configuration (.env)");
}
const cfg = loadEnv();
Object.assign(process.env, cfg);

try {
  // 2. Dependencies
  if (!existsSync(path.join(ROOT, "node_modules", "next"))) {
    say("Installing dependencies (npm ci)");
    await run("npm ci --no-audit --no-fund");
  } else {
    say("Dependencies already installed");
  }
  if (!cfg.CHROMIUM_PATH) {
    say("Downloading Chromium for PDF generation");
    await run("npx playwright install chromium");
  }

  // 3. Database: create, migrate, and load demo data on first run only
  say("Starting the local database");
  const db = await startDb(Number(cfg.LOCAL_PG_PORT ?? 54329), cfg.LOCAL_PG_PASSWORD);
  try {
    say("Applying database migrations");
    await run("npx prisma migrate deploy");
    if (db.firstRun) {
      say("Loading demo data");
      await run("npx tsx prisma/seed.ts");
    } else {
      console.log("  Existing data kept. To reset to the demo data, delete the .pgdata folder and run setup again.");
    }
  } finally {
    await db.stop();
  }

  // 4. Production build
  say("Building the application (a few minutes)");
  await run("npx next build");
} catch (e) {
  fail(`${e.message}\nFix the problem above and run setup again.`);
}

console.log("\n\x1b[32m✔ Setup complete.\x1b[0m The application is ready to start.\n");
