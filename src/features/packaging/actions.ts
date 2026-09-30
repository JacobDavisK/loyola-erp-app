"use server";

import { runAction } from "@/server/action";
import { requireAuth } from "@/server/auth/current";
import { buildPackage } from "@/server/services/packaging";

export async function buildPackageAction(input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("paper.package");
    return buildPackage(ctx, input);
  });
}
