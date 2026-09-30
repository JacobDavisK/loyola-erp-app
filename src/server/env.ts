import "server-only";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters"),
  DATA_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "DATA_ENCRYPTION_KEY must be 32 bytes, base64"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  EXAMCORE_DEMO_MODE: z.string().optional(),
  STORAGE_DRIVER: z.enum(["local"]).default("local"),
  STORAGE_DIR: z.string().default("./storage"),
  EMAIL_DRIVER: z.enum(["outbox"]).default("outbox"),
  EMAIL_FROM: z.string().default("University Platform <no-reply@example.edu>"),
  CHROMIUM_PATH: z.string().optional(),
  PAYMENT_GATEWAY: z.enum(["none", "razorpay"]).default("none"),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  /** AI assistance is off unless a provider and key are configured. */
  AI_PROVIDER: z.enum(["none", "anthropic"]).default("none"),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-sonnet-5"),
  AI_BASE_URL: z.string().url().default("https://api.anthropic.com"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment configuration:\n${parsed.error.issues.map((i) => ` • ${i.path.join(".")}: ${i.message}`).join("\n")}`);
}

export const env = parsed.data;

/** The demo role selector is available only outside production AND when explicitly enabled. */
export const demoModeEnabled = env.NODE_ENV !== "production" && env.EXAMCORE_DEMO_MODE === "true";
