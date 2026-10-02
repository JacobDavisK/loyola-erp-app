/**
 * One-time setup for running EXAMCORE on a single computer with demo data.
 * Safe to run again: existing configuration and data are kept.
 */
import { randomBytes } from "node:crypto";
import readline from "node:readline";
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

// The Super Admin's own sign-in, chosen during installation. Only the name is stored; the password is
// passed to the data loader once, which stores a hash, and is never written to disk in plain text.
function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Show a star for each character typed, including when the line is redrawn after a backspace.
    if (hidden) rl._writeToOutput = (s) => {
      const at = s.indexOf(question);
      const mask = (t) => t.replace(/[^\r\n]/g, "*");
      rl.output.write(at >= 0 ? s.slice(0, at + question.length) + mask(s.slice(at + question.length)) : mask(s));
    };
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(answer.trim()); });
  });
}
function passwordProblem(pw) {
  if (pw.length < 12) return "at least 12 characters";
  if (!/[A-Z]/.test(pw)) return "a capital letter";
  if (!/[a-z]/.test(pw)) return "a small letter";
  if (!/[0-9]/.test(pw)) return "a digit";
  return null;
}
async function chooseSuperAdmin() {
  if (!process.stdin.isTTY) {
    const pw = `${randomBytes(9).toString("base64url")}A1a`;
    console.log(`  No keyboard available. Super Admin: sign in as "admin" with the password ${pw} and change it under Profile.`);
    return { login: "admin", password: pw };
  }
  say("Choose the Super Admin's sign-in");
  console.log("  The Super Admin can do everything in the system. Choose a name and a strong password, and keep them safe.");
  let login = "";
  while (!/^[A-Za-z][A-Za-z0-9._-]{2,39}$/.test(login)) {
    login = await ask("  Sign-in name (letters, digits, . _ -; e.g. Jacob): ");
    if (!/^[A-Za-z][A-Za-z0-9._-]{2,39}$/.test(login)) console.log("  Use 3–40 characters, starting with a letter.");
  }
  for (;;) {
    const pw = await ask("  Password: ", true);
    const problem = passwordProblem(pw);
    if (problem) { console.log(`  The password needs ${problem}.`); continue; }
    if ((await ask("  Type the password again: ", true)) !== pw) { console.log("  The two passwords are different. Try again."); continue; }
    return { login, password: pw };
  }
}

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
      const admin = await chooseSuperAdmin();
      const envText = readFileSync(ENV_FILE, "utf8").replace(/^SUPER_ADMIN_LOGIN=.*\n?/m, "");
      writeFileSync(ENV_FILE, `${envText.trimEnd()}\nSUPER_ADMIN_LOGIN="${admin.login}"\n`);
      say("Loading demo data");
      await run("npx tsx prisma/seed.ts", { SUPER_ADMIN_LOGIN: admin.login, SUPER_ADMIN_PASSWORD: admin.password });
      console.log(`  Super Admin: sign in as "${admin.login}" with the password you chose.`);
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
