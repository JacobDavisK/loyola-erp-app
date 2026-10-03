import "server-only";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters"),
  DATA_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "DATA_ENCRYPTION_KEY must be 32 bytes, base64"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  EXAMCORE_DEMO_MODE: z.string().optional(),
  /** Video & collaboration (OpenVidu 3 / LiveKit protocol). "none" keeps scheduling, attendance and records but cannot connect media. */
  VIDEO_PROVIDER: z.enum(["none", "openvidu"]).default("none"),
  /** Server URL of OpenVidu, e.g. https://video.university.edu (browsers connect to the matching wss:// address) */
  OPENVIDU_URL: z.string().url().optional(),
  OPENVIDU_API_KEY: z.string().optional(),
  /** API secret (also signs webhooks). Never sent to browsers. Accepts OPENVIDU_SECRET as an alias. */
  OPENVIDU_API_SECRET: z.string().optional(),
  OPENVIDU_SECRET: z.string().optional(),
  OPENVIDU_RECORDING_ENABLED: z.enum(["true", "false"]).default("true"),
  /** Where OpenVidu writes recordings: "s3" (the bucket configured in OpenVidu, MinIO by default) or "none" */
  OPENVIDU_RECORDING_STORAGE: z.enum(["s3", "none"]).default("s3"),
  OPENVIDU_RECORDING_PREFIX: z.string().default("recordings/erp"),
  RECORDING_S3_ENDPOINT: z.string().url().optional(),
  RECORDING_S3_REGION: z.string().default("us-east-1"),
  RECORDING_S3_BUCKET: z.string().default("openvidu-appdata"),
  RECORDING_S3_ACCESS_KEY: z.string().optional(),
  RECORDING_S3_SECRET_KEY: z.string().optional(),
  RECORDING_S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("true"),
  /** Optional ICE overrides given to authorised browsers (OpenVidu normally supplies its own STUN/TURN). */
  OPENVIDU_STUN_SERVER: z.string().optional(),
  OPENVIDU_TURN_SERVER: z.string().optional(),
  OPENVIDU_TURN_USERNAME: z.string().optional(),
  OPENVIDU_TURN_CREDENTIAL: z.string().optional(),
  /** Sign-in branding for this installation (see src/lib/branding.ts) */
  UNIVERSITY_NAME: z.string().optional(),
  UNIVERSITY_LOGO: z.string().optional(),
  PRIMARY_COLOR: z.string().optional(),
  SECONDARY_COLOR: z.string().optional(),
  TAGLINE: z.string().optional(),
  CAMPUS_NAME: z.string().optional(),
  SUPPORT_EMAIL: z.string().optional(),
  /** The Super Admin's own sign-in name, when one was chosen for this installation (its account is then never offered for demo sign-in). */
  SUPER_ADMIN_LOGIN: z.string().optional(),
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
  /** SMS / WhatsApp delivery. "outbox" records messages without sending (development). */
  SMS_DRIVER: z.enum(["outbox", "twilio"]).default("outbox"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
  WHATSAPP_DRIVER: z.enum(["outbox", "meta"]).default("outbox"),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_ID: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  /** Approved WhatsApp template for alerts, with one body parameter */
  WHATSAPP_TEMPLATE: z.string().default("erp_alert"),
  /** Contact address shown to push services (VAPID subject) */
  PUSH_CONTACT: z.string().default("mailto:it@example.edu"),
});

const parsed = schema.superRefine((v, ctx) => {
  if (v.VIDEO_PROVIDER !== "openvidu") return;
  const secret = v.OPENVIDU_API_SECRET ?? v.OPENVIDU_SECRET;
  if (!v.OPENVIDU_URL) ctx.addIssue({ code: "custom", path: ["OPENVIDU_URL"], message: "required when VIDEO_PROVIDER=openvidu" });
  if (!v.OPENVIDU_API_KEY) ctx.addIssue({ code: "custom", path: ["OPENVIDU_API_KEY"], message: "required when VIDEO_PROVIDER=openvidu" });
  if (!secret) ctx.addIssue({ code: "custom", path: ["OPENVIDU_API_SECRET"], message: "required when VIDEO_PROVIDER=openvidu" });
  if (v.NODE_ENV === "production") {
    if (v.OPENVIDU_URL && !v.OPENVIDU_URL.startsWith("https://")) ctx.addIssue({ code: "custom", path: ["OPENVIDU_URL"], message: "must use https:// in production" });
    if (secret && secret.length < 32) ctx.addIssue({ code: "custom", path: ["OPENVIDU_API_SECRET"], message: "must be at least 32 characters in production" });
    if (v.OPENVIDU_RECORDING_ENABLED === "true" && v.OPENVIDU_RECORDING_STORAGE === "s3" && !(v.RECORDING_S3_ENDPOINT && v.RECORDING_S3_ACCESS_KEY && v.RECORDING_S3_SECRET_KEY)) {
      ctx.addIssue({ code: "custom", path: ["RECORDING_S3_ENDPOINT"], message: "recording storage (endpoint, access key, secret key) is required when recording is enabled" });
    }
  }
}).safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment configuration:\n${parsed.error.issues.map((i) => ` • ${i.path.join(".")}: ${i.message}`).join("\n")}`);
}

export const env = parsed.data;

/** The demo role selector is available only outside production AND when explicitly enabled. */
export const demoModeEnabled = env.NODE_ENV !== "production" && env.EXAMCORE_DEMO_MODE === "true";
