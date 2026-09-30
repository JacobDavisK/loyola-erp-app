/**
 * Publishes the current commit as a release for installed copies (see scripts/portable/update.mjs).
 * A snapshot of the tracked files, without history, is pushed to the public download repository
 * together with a VERSION file; installed copies pick it up on their own within 15 minutes.
 *
 *   npm run release
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = process.env.RELEASE_DIR ?? path.resolve(ROOT, "..", "examcore-installer", "public");

function sh(cmd, cwd = ROOT, capture = false) {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (r.status !== 0) {
    console.error(`\n"${cmd}" failed. Nothing was published.`);
    process.exit(1);
  }
  return (r.stdout ?? "").trim();
}

if (!existsSync(path.join(PUBLIC, ".git"))) {
  console.error(`The public download repository is not checked out at ${PUBLIC}.`);
  process.exit(1);
}
if (sh("git status --porcelain", ROOT, true)) {
  console.error("There are uncommitted changes. Commit them first; a release is always a commit.");
  process.exit(1);
}

sh("npm run typecheck");
sh("npm test");

const sha = sh("git rev-parse --short HEAD", ROOT, true);
const version = `${new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-")}-${sha}`;

for (const name of readdirSync(PUBLIC)) if (name !== ".git") rmSync(path.join(PUBLIC, name), { recursive: true, force: true });
sh(`git archive --format=tar HEAD | tar -x -C "${PUBLIC}"`);
writeFileSync(path.join(PUBLIC, "VERSION"), `${version}\n`);

sh("git add -A", PUBLIC);
sh(`git commit -q -m "Release ${version}"`, PUBLIC);
sh("git push -q origin HEAD:main", PUBLIC);
console.log(`\nPublished ${version}. Installed copies update on their own.`);
