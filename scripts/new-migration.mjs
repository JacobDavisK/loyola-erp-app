/**
 * Non-interactive replacement for `prisma migrate dev --create-only`.
 * Diffs the development database (which must be at the latest migration) against prisma/schema and
 * writes the SQL to prisma/migrations/<timestamp>_<name>/migration.sql for review. Hand-written SQL
 * (triggers, check constraints) can be appended to the file before running `npm run db:migrate`.
 *
 * Usage: node scripts/new-migration.mjs <name>
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const name = (process.argv[2] ?? "").replace(/[^a-z0-9_]/gi, "_").toLowerCase();
if (!name) {
  console.error("Usage: node scripts/new-migration.mjs <name>");
  process.exit(1);
}
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const status = execFileSync(npx, ["prisma", "migrate", "status"], { encoding: "utf8", shell: process.platform === "win32" });
if (!/up to date/i.test(status)) {
  console.error("The development database is not at the latest migration. Run `npm run db:migrate` first.\n" + status);
  process.exit(1);
}
const sql = execFileSync(npx, ["prisma", "migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema", "--script"], {
  encoding: "utf8",
  shell: process.platform === "win32",
  maxBuffer: 64 * 1024 * 1024,
});
if (!sql.trim() || /^-- This is an empty migration/.test(sql.trim())) {
  console.log("No schema changes.");
  process.exit(0);
}
const d = new Date();
const pad = (n) => String(n).padStart(2, "0");
const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
const dir = path.join("prisma", "migrations", `${stamp}_${name}`);
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "migration.sql"), sql);
console.log(`Created ${dir}/migration.sql — review it, then run npm run db:migrate`);
