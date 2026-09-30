import "server-only";
import { z } from "zod";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, invalid, notFound } from "@/server/errors";
import { audit } from "@/server/services/audit";

const need = (ctx: AuthContext) => {
  if (!can(ctx, "admin.templates.manage")) throw forbidden();
};

export const templateSchema = z.object({
  name: z.string().trim().min(3).max(120),
  headerTitle: z.string().trim().max(160).nullable(),
  headerSubtitle: z.string().trim().max(200).nullable(),
  instructions: z.string().max(3000).nullable(),
  footerText: z.string().trim().max(200).nullable(),
  fontFamily: z.enum(["Times New Roman", "Georgia", "Cambria", "Arial", "Calibri"]),
  fontSizePt: z.number().int().min(9).max(16),
  marginMm: z.number().int().min(10).max(30),
  showLogo: z.boolean(),
  showRegNoBoxes: z.boolean(),
  isDefault: z.boolean(),
});

export async function saveTemplate(ctx: AuthContext, id: string | null, raw: unknown) {
  need(ctx);
  const v = templateSchema.parse(raw);
  const t = await db.$transaction(async (tx) => {
    if (v.isDefault) await tx.template.updateMany({ where: { isDefault: true, ...(id ? { id: { not: id } } : {}) }, data: { isDefault: false } });
    const saved = id ? await tx.template.update({ where: { id }, data: v }) : await tx.template.create({ data: { ...v, kind: "PAPER" } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: id ? "template.update" : "template.create", resourceType: "template", resourceId: saved.id, summary: v.name, newValue: v }, tx);
    return saved;
  });
  return t;
}

export const watermarkSchema = z.object({
  name: z.string().trim().min(2).max(80),
  text: z.string().trim().min(3).max(160),
  opacity: z.number().min(0.02).max(0.3),
  angle: z.number().int().min(-90).max(90),
  appliesTo: z.array(z.enum(["PREVIEW", "DRAFT_PDF", "MODERATION_PDF", "FINAL_PDF"])).min(1, "Choose where the watermark applies"),
  isActive: z.boolean(),
});

export async function saveWatermark(ctx: AuthContext, id: string | null, raw: unknown) {
  need(ctx);
  const v = watermarkSchema.parse(raw);
  if (id && !(await db.watermark.findUnique({ where: { id } }))) throw notFound("Watermark");
  if (!v.isActive && id) {
    const otherFinal = await db.watermark.count({ where: { isActive: true, appliesTo: { has: "FINAL_PDF" }, id: { not: id } } });
    const thisFinal = (await db.watermark.findUnique({ where: { id } }))?.appliesTo.includes("FINAL_PDF");
    if (thisFinal && !otherFinal) throw invalid("At least one active watermark must apply to final PDFs (confidentiality policy).");
  }
  const w = id ? await db.watermark.update({ where: { id }, data: v }) : await db.watermark.create({ data: v });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: id ? "watermark.update" : "watermark.create", resourceType: "watermark", resourceId: w.id, summary: v.name, newValue: v });
  return w;
}
