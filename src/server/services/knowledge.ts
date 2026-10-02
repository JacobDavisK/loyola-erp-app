import "server-only";
import { z } from "zod";
import type { NoticeAudience, Prisma } from "@/generated/prisma/client";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { conflict, forbidden, notFound } from "@/server/errors";
import { audit } from "@/server/services/audit";

/**
 * Knowledge base: short articles (fees, examinations, hostel, certificates…) that the student assistant
 * answers from, and that anyone can search. Only published articles for the reader's audience are shown.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });

export function audiencesFor(ctx: AuthContext): NoticeAudience[] {
  const t = ctx.user.userType;
  return ["ALL", t === "STUDENT" ? "STUDENT" : t === "GUARDIAN" ? "GUARDIAN" : "STAFF"];
}

const articleSchema = z.object({
  title: z.string().trim().min(5).max(200),
  category: z.string().trim().min(2).max(60),
  audience: z.enum(["ALL", "STUDENT", "STAFF", "GUARDIAN"]),
  tags: z.string().trim().max(300).nullable().optional(),
  body: z.string().trim().min(20).max(20_000),
  published: z.boolean(),
});

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

export async function saveArticle(ctx: AuthContext, id: string | null, raw: unknown) {
  if (!can(ctx, "knowledge.manage")) throw forbidden();
  const v = articleSchema.parse(raw);
  const tags = (v.tags ?? "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 12);
  const data = { title: v.title, category: v.category, audience: v.audience, tags, body: v.body, published: v.published, updatedById: ctx.user.id };
  let a;
  if (id) {
    a = await db.knowledgeArticle.update({ where: { id }, data });
  } else {
    const slug = slugify(v.title);
    if (await db.knowledgeArticle.findUnique({ where: { slug } })) throw conflict("An article with a very similar title exists.");
    a = await db.knowledgeArticle.create({ data: { ...data, slug } });
  }
  await audit({ ...actor(ctx), action: "knowledge.save", resourceType: "knowledgeArticle", resourceId: a.id, summary: `${v.title}${v.published ? "" : " (draft)"}` });
  return a;
}

export async function deleteArticle(ctx: AuthContext, id: string) {
  if (!can(ctx, "knowledge.manage")) throw forbidden();
  const a = await db.knowledgeArticle.findUnique({ where: { id } });
  if (!a) throw notFound("Article");
  await db.knowledgeArticle.delete({ where: { id } });
  await audit({ ...actor(ctx), action: "knowledge.delete", resourceType: "knowledgeArticle", resourceId: id, summary: a.title });
}

const STOP = new Set("a an the is are was what how when where who why do does can i my me to of for in on at and or with about from be it this that".split(" "));
export const keywords = (q: string) => [...new Set(q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)))].slice(0, 8);

/** Ranked search: title and tag matches outrank body matches. */
export async function searchArticles(ctx: AuthContext, q: string, limit = 5) {
  const words = keywords(q);
  const base: Prisma.KnowledgeArticleWhereInput = can(ctx, "knowledge.manage") ? {} : { published: true, audience: { in: audiencesFor(ctx) } };
  if (!words.length) return db.knowledgeArticle.findMany({ where: base, orderBy: { updatedAt: "desc" }, take: limit });
  const rows = await db.knowledgeArticle.findMany({
    where: { ...base, OR: words.flatMap((w) => [{ title: { contains: w, mode: "insensitive" as const } }, { body: { contains: w, mode: "insensitive" as const } }, { tags: { has: w } }]) },
    take: 50,
  });
  const score = (a: (typeof rows)[number]) => words.reduce((s, w) => s + (a.title.toLowerCase().includes(w) ? 3 : 0) + (a.tags.includes(w) ? 2 : 0) + (a.body.toLowerCase().includes(w) ? 1 : 0), 0);
  return rows.map((a) => ({ a, s: score(a) })).sort((x, y) => y.s - x.s).slice(0, limit).map((x) => x.a);
}
