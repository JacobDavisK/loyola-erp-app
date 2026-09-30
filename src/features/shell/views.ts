"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction } from "@/server/action";
import { requireAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { invalid } from "@/server/errors";

const schema = z.object({
  scope: z.string().regex(/^[a-z][a-z0-9.-]{1,40}$/),
  name: z.string().trim().min(1).max(60),
  query: z.record(z.string(), z.string().max(200)),
  path: z.string().startsWith("/").max(100),
});

/** Personal saved views for any data grid (filters + sort, stored as the URL query). */
export async function saveViewAction(input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth();
    const v = schema.parse(input);
    if ((await db.savedFilter.count({ where: { userId: ctx.user.id, scope: v.scope } })) >= 20) throw invalid("You can keep up to 20 saved views per list.");
    await db.savedFilter.create({ data: { userId: ctx.user.id, scope: v.scope, name: v.name, query: v.query } });
    revalidatePath(v.path);
  }, "View saved");
}

export async function deleteViewAction(id: string, path: string) {
  return runAction(async () => {
    const ctx = await requireAuth();
    await db.savedFilter.deleteMany({ where: { id, userId: ctx.user.id } });
    revalidatePath(String(path).startsWith("/") ? path : "/");
  }, "View deleted");
}
