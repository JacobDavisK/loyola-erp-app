import { execSync } from "node:child_process";
import "dotenv/config";
import pg from "pg";

/**
 * Recreates the disposable `examcore_test` database, applies migrations and loads the demo seed.
 * It only ever drops the database named by TEST_DATABASE_NAME (default examcore_test).
 */
export default async function setup() {
  const devUrl = new URL(process.env.DATABASE_URL!);
  const testName = process.env.TEST_DATABASE_NAME ?? "examcore_test";
  if (!/_test$/.test(testName)) throw new Error("Refusing to recreate a database whose name does not end in _test.");
  const adminUrl = new URL(devUrl);
  adminUrl.pathname = "/postgres";
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  await client.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [testName]);
  await client.query(`DROP DATABASE IF EXISTS "${testName}"`);
  await client.query(`CREATE DATABASE "${testName}"`);
  await client.end();

  const testUrl = new URL(devUrl);
  testUrl.pathname = `/${testName}`;
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: testUrl.toString(), NODE_ENV: "test" };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
  process.env.TEST_DATABASE_URL = testUrl.toString();
}
