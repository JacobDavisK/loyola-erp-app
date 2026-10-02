import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
/** The payment provider's checkout is allowed only when that gateway is configured (see src/server/payments/gateway.ts). */
const razorpay = process.env.PAYMENT_GATEWAY === "razorpay";
const gwScript = razorpay ? " https://checkout.razorpay.com" : "";
const gwFrame = razorpay ? "frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com" : "frame-src 'self'";
const gwConnect = razorpay ? " https://api.razorpay.com https://lumberjack.razorpay.com" : "";

/** Strict security headers. 'unsafe-inline' styles are required by KaTeX/Next style injection. */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}${gwScript}`,
  gwFrame,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'" + gwConnect + (isDev ? " ws: wss:" : ""),
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

/** LTI launches post the login request / id_token to the external tool, so form-action must allow it there only. */
const ltiCsp = csp.replace("form-action 'self'", `form-action 'self' https:${isDev ? " http:" : ""}`);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2", "playwright-core", "embedded-postgres"],
  experimental: {
    // Course material uploads go through server actions (per-kind limits are enforced in storage.ts).
    serverActions: { bodySizeLimit: "16mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          // Camera (proctored quizzes) and location (classroom check-in) are for this site only, and only after the browser asks.
          { key: "Permissions-Policy", value: `camera=(self), microphone=(), geolocation=(self), payment=${razorpay ? '(self "https://api.razorpay.com")' : "()"}` },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
        ],
      },
      // Listed last so it replaces the default policy on these two routes.
      { source: "/lti/launch/:path*", headers: [{ key: "Content-Security-Policy", value: ltiCsp }] },
      { source: "/api/lti/authorize", headers: [{ key: "Content-Security-Policy", value: ltiCsp }] },
    ];
  },
};

export default nextConfig;
