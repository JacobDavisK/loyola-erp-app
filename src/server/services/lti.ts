import "server-only";
import { generateKeyPairSync, randomBytes, type JsonWebKey } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { BRAND } from "@/lib/brand";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { decryptString, encryptString, sha256 } from "@/server/security/crypto";
import { decodeJwt, signRs256, verifyRs256 } from "@/server/security/jwt";
import { audit } from "@/server/services/audit";
import { courseSpace } from "@/server/services/lms";

/**
 * LTI 1.3 Core with Assignment and Grade Services, this system acting as the platform.
 *
 *  Launch: the course page opens /lti/launch/<link>, which records a launch and starts the tool's
 *  third-party-initiated OIDC login. The tool redirects the browser to /api/lti/authorize; we check the
 *  signed-in user is the one who launched, then post an RS256-signed id_token to the tool's launch URL.
 *  Keys are published at /api/lti/jwks.
 *
 *  Grades: a tool obtains an access token at /api/lti/token with a client-credentials JWT signed by its
 *  own key (fetched from the tool's JWKS URL), then posts scores to the link's line item. Scores land in
 *  the class gradebook, from where the teacher may transfer them into an assessment component.
 *
 *  Personal data (name, e-mail) is sent only when the tool is configured to receive it.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });
const CLAIM = "https://purl.imsglobal.org/spec/lti/claim/";
const AGS = "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint";
export const SCOPE_SCORE = "https://purl.imsglobal.org/spec/lti-ags/scope/score";
export const SCOPE_LINEITEM_RO = "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly";
const issuer = () => env.APP_URL.replace(/\/$/, "");

// ───────────────────────── Keys ─────────────────────────

async function signingKey() {
  const k = await db.ltiKey.findFirst({ where: { active: true }, orderBy: { createdAt: "desc" } });
  if (k) return { kid: k.kid, privateKey: decryptString(k.privateKey) };
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = randomBytes(8).toString("hex");
  const jwk = { ...(publicKey.export({ format: "jwk" }) as JsonWebKey), kid, alg: "RS256", use: "sig" };
  const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  await db.ltiKey.create({ data: { kid, privateKey: encryptString(pem), publicJwk: jwk as unknown as Prisma.InputJsonValue } });
  return { kid, privateKey: pem };
}

export async function platformJwks() {
  await signingKey();
  const keys = await db.ltiKey.findMany({ where: { active: true }, select: { publicJwk: true } });
  return { keys: keys.map((k) => k.publicJwk) };
}

// ───────────────────────── Tools and placements ─────────────────────────

const url = z.string().trim().url().refine((u) => u.startsWith("https://") || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u), "Use an https:// address");
const toolSchema = z.object({
  name: z.string().trim().min(2).max(120),
  oidcLoginUrl: url,
  launchUrl: url,
  jwksUrl: url,
  redirectUris: z.string().trim().max(2000).nullable().optional(),
  sharePersonalData: z.boolean(),
  enabled: z.boolean(),
});

export async function saveTool(ctx: AuthContext, id: string | null, raw: unknown) {
  if (!can(ctx, "lti.manage")) throw forbidden();
  const v = toolSchema.parse(raw);
  const redirectUris = (v.redirectUris ?? "").split(/[\s,]+/).filter(Boolean);
  for (const r of redirectUris) url.parse(r);
  const data = { name: v.name, oidcLoginUrl: v.oidcLoginUrl, launchUrl: v.launchUrl, jwksUrl: v.jwksUrl, redirectUris, sharePersonalData: v.sharePersonalData, enabled: v.enabled };
  const t = id
    ? await db.ltiTool.update({ where: { id }, data })
    : await db.ltiTool.create({ data: { ...data, clientId: randomBytes(12).toString("hex"), deploymentId: randomBytes(6).toString("hex"), createdById: ctx.user.id } });
  await audit({ ...actor(ctx), action: "lti.tool.save", resourceType: "ltiTool", resourceId: t.id, summary: `${v.name}${v.sharePersonalData ? " (receives names and e-mails)" : ""}${v.enabled ? "" : " (disabled)"}` });
  return t;
}

export function platformDetails() {
  const base = issuer();
  return { issuer: base, authorizeUrl: `${base}/api/lti/authorize`, tokenUrl: `${base}/api/lti/token`, jwksUrl: `${base}/api/lti/jwks` };
}

/** A teacher places a tool in a module of their class (it appears as a course item). */
export async function addLink(ctx: AuthContext, moduleId: string, raw: unknown) {
  const mod = await db.courseModule.findUnique({ where: { id: moduleId } });
  if (!mod) throw notFound("Module");
  const s = await courseSpace(ctx, mod.offeringId);
  if (s.role !== "teacher") throw forbidden();
  const v = z.object({ toolId: z.string(), title: z.string().trim().min(2).max(200), maxScore: z.number().positive().max(1000).nullable().optional(), custom: z.string().trim().max(2000).nullable().optional() }).parse(raw);
  const tool = await db.ltiTool.findFirst({ where: { id: v.toolId, enabled: true } });
  if (!tool) throw invalid("Choose an enabled tool.");
  const custom: Record<string, string> = {};
  for (const line of (v.custom ?? "").split(/\r?\n/)) {
    const m = /^\s*([a-z0-9_]{1,40})\s*=\s*(.{0,200})$/i.exec(line);
    if (m) custom[m[1]] = m[2].trim();
  }
  return db.$transaction(async (tx) => {
    const link = await tx.ltiLink.create({ data: { toolId: tool.id, offeringId: mod.offeringId, title: v.title, maxScore: v.maxScore ?? null, custom, createdById: ctx.user.id } });
    const order = await tx.learningItem.count({ where: { moduleId } });
    await tx.learningItem.create({ data: { moduleId, kind: "LTI", title: v.title, ltiLinkId: link.id, order, isPublished: true, createdById: ctx.user.id } });
    await audit({ ...actor(ctx), action: "lti.link.add", resourceType: "offering", resourceId: mod.offeringId, summary: `${tool.name}: ${v.title}` }, tx);
    return link;
  });
}

// ───────────────────────── Launch ─────────────────────────

async function linkForUser(ctx: AuthContext, linkId: string) {
  const link = await db.ltiLink.findUnique({ where: { id: linkId }, include: { tool: true, offering: { include: { course: { select: { code: true, title: true } } } } } });
  if (!link || !link.tool.enabled) throw notFound("Tool");
  const s = await courseSpace(ctx, link.offeringId);
  if (!s.role) throw notFound("Tool");
  return { link, role: s.role };
}

/** Step 1: record the launch and return the tool's OIDC login initiation request. */
export async function startLaunch(ctx: AuthContext, linkId: string) {
  const { link } = await linkForUser(ctx, linkId);
  const launch = await db.ltiLaunch.create({ data: { linkId, userId: ctx.user.id } });
  return {
    action: link.tool.oidcLoginUrl,
    params: { iss: issuer(), login_hint: launch.id, lti_message_hint: launch.id, target_link_uri: link.tool.launchUrl, client_id: link.tool.clientId, lti_deployment_id: link.tool.deploymentId },
  };
}

const authSchema = z.object({
  scope: z.string(), response_type: z.literal("id_token"), client_id: z.string(), redirect_uri: z.string(), login_hint: z.string(), state: z.string().max(2000).optional(),
  nonce: z.string().min(1).max(500), response_mode: z.literal("form_post").optional(), prompt: z.string().optional(), lti_message_hint: z.string().optional(),
});

/** Step 2: the tool's authentication request. Returns where to post the id_token. */
export async function authorizeLaunch(ctx: AuthContext, raw: Record<string, string>) {
  const v = authSchema.parse(raw);
  if (!v.scope.split(" ").includes("openid")) throw invalid("The tool must request the openid scope.");
  const launch = await db.ltiLaunch.findUnique({ where: { id: v.login_hint } });
  if (!launch || launch.userId !== ctx.user.id) throw forbidden("This launch was started by someone else. Open the tool again from the course page.");
  if (launch.usedAt || Date.now() - launch.createdAt.getTime() > 5 * 60_000) throw workflowError("This launch has expired. Open the tool again from the course page.");
  const { link, role } = await linkForUser(ctx, launch.linkId);
  if (v.client_id !== link.tool.clientId) throw forbidden("The tool identified itself with the wrong client id.");
  const allowed = [link.tool.launchUrl, ...link.tool.redirectUris];
  if (!allowed.includes(v.redirect_uri)) throw forbidden("The tool asked to send the launch to an address it is not registered with.");
  await db.ltiLaunch.update({ where: { id: launch.id }, data: { usedAt: new Date() } });
  const key = await signingKey();
  const now = Math.floor(Date.now() / 1000);
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { name: true, email: true } });
  const [given, ...rest] = user.name.split(" ");
  const payload: Record<string, unknown> = {
    iss: issuer(), aud: link.tool.clientId, azp: link.tool.clientId, sub: ctx.user.id, iat: now, exp: now + 300, nonce: v.nonce,
    [`${CLAIM}message_type`]: "LtiResourceLinkRequest",
    [`${CLAIM}version`]: "1.3.0",
    [`${CLAIM}deployment_id`]: link.tool.deploymentId,
    [`${CLAIM}target_link_uri`]: link.tool.launchUrl,
    [`${CLAIM}resource_link`]: { id: link.id, title: link.title },
    [`${CLAIM}roles`]: [role === "student" ? "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner" : "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"],
    [`${CLAIM}context`]: { id: link.offeringId, label: `${link.offering.course.code}-${link.offering.section}`, title: link.offering.course.title, type: ["http://purl.imsglobal.org/vocab/lis/v2/course#CourseOffering"] },
    [`${CLAIM}tool_platform`]: { guid: sha256(issuer()).slice(0, 32), name: BRAND.name, product_family_code: "examcore", version: "1" },
    [`${CLAIM}custom`]: link.custom,
    [`${CLAIM}launch_presentation`]: { document_target: "window", return_url: `${issuer()}/courses/items/${link.id}` },
    ...(link.tool.sharePersonalData ? { name: user.name, given_name: given, family_name: rest.join(" "), email: user.email } : {}),
    ...(link.maxScore ? { [AGS]: { scope: [SCOPE_LINEITEM_RO, SCOPE_SCORE], lineitems: `${issuer()}/api/lti/lineitems/${link.id}`, lineitem: `${issuer()}/api/lti/lineitems/${link.id}/item` } } : {}),
  };
  await audit({ ...actor(ctx), action: "lti.launch", resourceType: "ltiLink", resourceId: link.id, summary: `${link.tool.name}: ${link.title} (${role})` });
  return { redirectUri: v.redirect_uri, idToken: signRs256(payload, key.privateKey, key.kid), state: v.state ?? null };
}

// ───────────────────────── Grades (AGS) ─────────────────────────

const jwksCache = new Map<string, { at: number; keys: JsonWebKey[] }>();
async function toolKeys(jwksUrl: string): Promise<JsonWebKey[]> {
  const c = jwksCache.get(jwksUrl);
  if (c && Date.now() - c.at < 10 * 60_000) return c.keys;
  const res = await fetch(jwksUrl, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error("The tool's key set could not be fetched");
  const keys = ((await res.json()) as { keys?: JsonWebKey[] }).keys ?? [];
  jwksCache.set(jwksUrl, { at: Date.now(), keys });
  return keys;
}

/** For tests: inject a tool key set without a network fetch. */
export function primeToolKeys(jwksUrl: string, keys: JsonWebKey[]) {
  jwksCache.set(jwksUrl, { at: Date.now(), keys });
}

export async function issueToken(form: Record<string, string>) {
  if (form.grant_type !== "client_credentials" || form.client_assertion_type !== "urn:ietf:params:oauth:client-assertion-type:jwt-bearer" || !form.client_assertion) throw invalid("unsupported_grant_type");
  const clientId = String(decodeJwt(form.client_assertion).payload.iss ?? "");
  const tool = await db.ltiTool.findUnique({ where: { clientId } });
  if (!tool || !tool.enabled) throw forbidden("invalid_client");
  verifyRs256(form.client_assertion, await toolKeys(tool.jwksUrl), { iss: clientId, aud: `${issuer()}/api/lti/token`, maxAgeSeconds: 600 });
  const requested = (form.scope ?? "").split(" ").filter(Boolean);
  const scopes = requested.filter((s) => s === SCOPE_SCORE || s === SCOPE_LINEITEM_RO);
  if (!scopes.length) throw invalid("invalid_scope");
  const token = randomBytes(32).toString("base64url");
  await db.ltiToken.create({ data: { clientId, tokenHash: sha256(token), scopes, expiresAt: new Date(Date.now() + 3600_000) } });
  return { access_token: token, token_type: "Bearer", expires_in: 3600, scope: scopes.join(" ") };
}

async function bearer(authorization: string | null, scope: string, linkId: string) {
  const token = authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const t = token ? await db.ltiToken.findUnique({ where: { tokenHash: sha256(token) } }) : null;
  if (!t || t.expiresAt < new Date() || !t.scopes.includes(scope)) throw forbidden("invalid_token");
  const link = await db.ltiLink.findUnique({ where: { id: linkId }, include: { tool: true } });
  if (!link || link.tool.clientId !== t.clientId || !link.maxScore) throw notFound("Line item");
  return link;
}

export async function lineItem(authorization: string | null, linkId: string) {
  const link = await bearer(authorization, SCOPE_LINEITEM_RO, linkId);
  return { id: `${issuer()}/api/lti/lineitems/${link.id}/item`, scoreMaximum: link.maxScore, label: link.title, resourceLinkId: link.id };
}

const scoreSchema = z.object({
  userId: z.string(), scoreGiven: z.number().min(0).optional(), scoreMaximum: z.number().positive().optional(), comment: z.string().max(2000).optional(),
  activityProgress: z.enum(["Initialized", "Started", "InProgress", "Submitted", "Completed"]), gradingProgress: z.enum(["FullyGraded", "Pending", "PendingManual", "Failed", "NotReady"]), timestamp: z.coerce.date(),
});

export async function postScore(authorization: string | null, linkId: string, raw: unknown) {
  const link = await bearer(authorization, SCOPE_SCORE, linkId);
  const v = scoreSchema.parse(raw);
  const student = await db.student.findFirst({ where: { userId: v.userId, registrations: { some: { offeringId: link.offeringId, status: { in: ["REGISTERED", "COMPLETED"] } } } }, select: { id: true } });
  if (!student) throw notFound("Learner");
  const max = v.scoreMaximum ?? link.maxScore!;
  if (v.scoreGiven !== undefined && v.scoreGiven > max * 1.5) throw invalid("scoreGiven exceeds scoreMaximum");
  await db.ltiScore.create({ data: { linkId, studentId: student.id, scoreGiven: v.scoreGiven ?? null, scoreMaximum: max, activityProgress: v.activityProgress, gradingProgress: v.gradingProgress, comment: v.comment ?? null, timestamp: v.timestamp } });
}

/** Latest fully graded score per student, scaled to the link's maximum (used by the gradebook). */
export async function linkScores(linkId: string, max: number) {
  const rows = await db.ltiScore.findMany({ where: { linkId, gradingProgress: "FullyGraded", scoreGiven: { not: null } }, orderBy: { timestamp: "desc" } });
  const out = new Map<string, number>();
  for (const r of rows) if (!out.has(r.studentId)) out.set(r.studentId, Math.round(((r.scoreGiven! / r.scoreMaximum) * max) * 100) / 100);
  return out;
}
