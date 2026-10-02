import "server-only";
import { createPublicKey, createSign, createVerify, type JsonWebKey, type KeyObject } from "node:crypto";

/** Minimal RS256 JSON Web Tokens (for LTI 1.3). No external dependency; only RS256 is accepted. */

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signRs256(payload: Record<string, unknown>, privateKeyPem: string, kid: string): string {
  const header = b64(JSON.stringify({ alg: "RS256", typ: "JWT", kid }));
  const body = b64(JSON.stringify(payload));
  const sig = createSign("RSA-SHA256").update(`${header}.${body}`).sign(privateKeyPem);
  return `${header}.${body}.${b64(sig)}`;
}

export interface DecodedJwt {
  header: { alg?: string; kid?: string; typ?: string };
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Buffer;
}

export function decodeJwt(token: string): DecodedJwt {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");
  return {
    header: JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")),
    payload: JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")),
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: Buffer.from(parts[2], "base64url"),
  };
}

/** Verify an RS256 token against a set of JWKs; checks exp/nbf/iat with 60 s leeway, plus iss/aud when given. */
export function verifyRs256(token: string, keys: JsonWebKey[], expect: { iss?: string; aud?: string; maxAgeSeconds?: number } = {}): Record<string, unknown> {
  const d = decodeJwt(token);
  if (d.header.alg !== "RS256") throw new Error("Only RS256 is accepted");
  const candidates = keys.filter((k) => k.kty === "RSA" && (!d.header.kid || k.kid === d.header.kid));
  let key: KeyObject | null = null;
  for (const k of candidates) {
    const pub = createPublicKey({ key: k, format: "jwk" });
    if (createVerify("RSA-SHA256").update(d.signingInput).verify(pub, d.signature)) { key = pub; break; }
  }
  if (!key) throw new Error("Invalid signature");
  const now = Math.floor(Date.now() / 1000);
  const p = d.payload;
  if (typeof p.exp !== "number" || p.exp + 60 < now) throw new Error("Token expired");
  if (typeof p.nbf === "number" && p.nbf - 60 > now) throw new Error("Token not yet valid");
  if (expect.maxAgeSeconds && typeof p.iat === "number" && now - p.iat > expect.maxAgeSeconds + 60) throw new Error("Token too old");
  if (expect.iss && p.iss !== expect.iss) throw new Error("Wrong issuer");
  if (expect.aud) {
    const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
    if (!aud.includes(expect.aud)) throw new Error("Wrong audience");
  }
  return p;
}
