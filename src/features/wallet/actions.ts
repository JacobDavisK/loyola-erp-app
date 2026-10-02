"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAuth } from "@/server/auth/current";
import { requestMeta } from "@/server/request-context";
import { assertRate } from "@/server/security/rate-limit";
import { academicVc, awardBadge, createShare, learnerRecord, revokeBadgeAward, revokeShare, saveBadge, verifyVcJwt } from "@/server/services/vc";

const refresh = (...paths: string[]) => {
  for (const p of paths) revalidatePath(p, "layout");
};

export async function academicVcAction(issuedCredentialId: string) {
  return runAction(async () => { await academicVc(await requireAuth(), issuedCredentialId); refresh("/portal/wallet", "/students"); }, "Verifiable credential issued");
}
export async function learnerRecordAction() {
  return runAction(async () => { const ctx = await requireAuth("self.portal"); await learnerRecord(ctx, ctx.subject.studentId ?? ""); refresh("/portal/wallet"); }, "Learner record issued");
}
export async function createShareAction(vcId: string, input: unknown) {
  return runAction(async () => { const url = await createShare(await requireAuth(), vcId, input); refresh("/portal/wallet"); return { url }; });
}
export async function revokeShareAction(id: string) {
  return runAction(async () => { await revokeShare(await requireAuth(), id); refresh("/portal/wallet"); }, "Link switched off");
}
export async function saveBadgeAction(id: string | null, input: unknown) {
  return runAction(async () => { await saveBadge(await requireAuth("badge.manage"), id, input); refresh("/credentials/badges"); }, "Badge saved");
}
export async function awardBadgeAction(badgeId: string, _id: string | null, input: unknown) {
  return runAction(async () => { const n = await awardBadge(await requireAuth("badge.manage"), badgeId, input); refresh("/credentials/badges"); return { awarded: n }; }, "Badge awarded and issued as a verifiable credential");
}
export async function revokeBadgeAwardAction(id: string, reason: string) {
  return runAction(async () => { await revokeBadgeAward(await requireAuth("badge.manage"), id, reason); refresh("/credentials/badges"); }, "Award revoked");
}
/** Public: anyone can paste a credential to check it. */
export async function verifyVcAction(jwt: string) {
  return runAction(async () => {
    assertRate(`vc-verify:${(await requestMeta()).ip ?? "unknown"}`, 30, 60_000);
    const r = await verifyVcJwt(String(jwt ?? "").slice(0, 100_000));
    return { valid: r.valid, problems: r.problems, name: (r.vc?.name as string) ?? null, subject: ((r.vc?.credentialSubject as { name?: string })?.name) ?? null, issuedAt: r.issuedAt?.toISOString() ?? null };
  });
}
