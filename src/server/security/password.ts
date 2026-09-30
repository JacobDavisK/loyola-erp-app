import "server-only";
import { hash, verify } from "@node-rs/argon2";

// OWASP-recommended Argon2id parameters
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export const hashPassword = (password: string) => hash(password, OPTS);

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

export interface PasswordPolicy {
  minLength: number;
  requireUpper: boolean;
  requireLower: boolean;
  requireDigit: boolean;
  requireSymbol: boolean;
  maxAgeDays: number;
}

export function checkPasswordPolicy(password: string, policy: PasswordPolicy, context: string[] = []): string[] {
  const errors: string[] = [];
  if (password.length < policy.minLength) errors.push(`At least ${policy.minLength} characters`);
  if (policy.requireUpper && !/[A-Z]/.test(password)) errors.push("An uppercase letter");
  if (policy.requireLower && !/[a-z]/.test(password)) errors.push("A lowercase letter");
  if (policy.requireDigit && !/\d/.test(password)) errors.push("A number");
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) errors.push("A symbol");
  const lower = password.toLowerCase();
  if (context.some((c) => c.length >= 4 && lower.includes(c.toLowerCase()))) errors.push("Must not contain your name, e-mail or employee ID");
  return errors;
}
