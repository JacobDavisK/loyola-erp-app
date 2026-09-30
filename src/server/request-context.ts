import "server-only";
import { headers } from "next/headers";

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export async function requestMeta(): Promise<RequestMeta> {
  try {
    const h = await headers();
    const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
    return { ip: fwd || h.get("x-real-ip") || null, userAgent: h.get("user-agent") };
  } catch {
    return { ip: null, userAgent: null }; // outside a request (seed, scripts)
  }
}

export function describeDevice(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Mac OS X/.test(ua)
      ? "macOS"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "Unknown OS";
  return `${browser} on ${os}`;
}
