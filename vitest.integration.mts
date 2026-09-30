import path from "node:path";
import { defineConfig } from "vitest/config";

/** Integration tests run against a disposable `examcore_test` database (never the dev database). */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/support/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["./tests/support/integration-global-setup.ts"],
    setupFiles: ["./tests/support/integration-setup.ts"],
    testTimeout: 120_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
