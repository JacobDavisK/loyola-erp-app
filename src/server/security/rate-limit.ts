import "server-only";
import { rateLimited } from "@/server/errors";

/**
 * In-process sliding-window limiter for API bursts. Login brute-force protection additionally
 * uses the persistent LoginAttempt table so limits survive restarts and span instances.
 * For multi-instance deployments, back this with Redis behind the same interface.
 */
const buckets = new Map<string, number[]>();

export function hit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  buckets.set(key, arr);
  if (buckets.size > 50_000) {
    for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  }
  return arr.length <= limit;
}

export function assertRate(key: string, limit: number, windowMs: number): void {
  if (!hit(key, limit, windowMs)) throw rateLimited();
}
