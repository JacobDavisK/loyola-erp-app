import { buildAuthContext, type AuthContext } from "@/server/auth/current";
import { db } from "@/server/db";

export async function as(handle: string): Promise<AuthContext> {
  const u = await db.user.findUniqueOrThrow({ where: { email: `${handle}@example.edu` } });
  const ctx = await buildAuthContext(u.id, `test-${handle}`);
  if (!ctx) throw new Error(`No context for ${handle}`);
  return ctx;
}

export async function paperByCode(code: string) {
  return db.questionPaper.findUniqueOrThrow({ where: { code } });
}
