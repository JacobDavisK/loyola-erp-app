import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
export { canonicalJson, sha256 } from "@/lib/hash";
import { env } from "@/server/env";

const KEY = Buffer.from(env.DATA_ENCRYPTION_KEY, "base64");

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}


export function hmac(data: string): string {
  return createHmac("sha256", env.APP_SECRET).update(data).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** AES-256-GCM. Output layout: iv(12) | tag(16) | ciphertext */
export function encryptBuffer(plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]);
}

export function decryptBuffer(payload: Buffer): Buffer {
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]);
}

export const encryptString = (s: string) => encryptBuffer(Buffer.from(s, "utf8")).toString("base64");
export const decryptString = (s: string) => decryptBuffer(Buffer.from(s, "base64")).toString("utf8");

