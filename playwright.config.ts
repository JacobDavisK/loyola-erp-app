import { defineConfig, devices } from "@playwright/test";
import "dotenv/config";

/**
 * End-to-end tests run a production build (`next start`) on :3200 against the disposable
 * `examcore_test` database, recreated and seeded by the global setup. Run `npm run build` first.
 */
const dev = new URL(process.env.DATABASE_URL!);
dev.pathname = "/examcore_test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3200", trace: "retain-on-failure", viewport: { width: 1440, height: 900 } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "npx tsx tests/support/reset-test-db.ts && npx next start -p 3200",
    url: "http://localhost:3200/api/health",
    reuseExistingServer: false,
    timeout: 300_000,
    env: { DATABASE_URL: dev.toString(), APP_URL: "http://localhost:3200", STORAGE_DIR: "./storage-test", EXAMCORE_DEMO_MODE: "false" },
  },
});
