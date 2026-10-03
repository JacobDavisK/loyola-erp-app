import "server-only";
import { z } from "zod";
import type { AuthContext } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, notFound, workflowError } from "@/server/errors";
import { hit } from "@/server/security/rate-limit";
import { audit } from "@/server/services/audit";
import { log } from "@/server/video/log";
import { videoProvider } from "@/server/video/provider";
import { assertSee, isHostLike, isModerator, loadMeeting, myParticipant } from "./access";

/**
 * Meeting chat goes through the ERP: the server checks the sender may chat, stores the message (retained
 * per policy, moderatable) and relays it into the room. The browser never writes chat straight to the room,
 * so a disabled chat or a removed participant really cannot post.
 */

export async function postChat(ctx: AuthContext, idOrPublicId: string, raw: unknown) {
  const v = z.object({ message: z.string().trim().min(1).max(2000) }).parse(raw);
  if (!hit(`video-chat:${ctx.user.id}`, 20, 10_000)) throw workflowError("You are sending messages too quickly.");
  const m = await loadMeeting(idOrPublicId);
  const p = myParticipant(ctx, m);
  const host = isHostLike(ctx, m);
  if (!host && (!p || p.connectionStatus !== "CONNECTED" || p.role === "OBSERVER")) throw forbidden("You can chat while you are in the meeting.");
  if (!m.chatEnabled && !host) throw forbidden("Chat is switched off for this meeting.");
  if (m.status !== "LIVE") throw workflowError("Chat is available while the meeting is live.");
  const msg = await db.videoChatMessage.create({ data: { meetingId: m.id, senderUserId: ctx.user.id, senderName: p?.displayName ?? ctx.user.name, message: v.message } });
  const payload = { id: msg.id, sender: msg.senderName, senderId: ctx.user.id, message: msg.message, at: msg.createdAt.toISOString() };
  await (await videoProvider()).sendData(m.roomName, "chat", payload).catch((e) => log("warn", "video.chat_relay_failed", { meeting: m.publicId, detail: String(e) }));
  return payload;
}

/** The conversation so far: for people in the meeting while live, and for its hosts afterwards. */
export async function chatHistory(ctx: AuthContext, idOrPublicId: string) {
  const m = await loadMeeting(idOrPublicId);
  await assertSee(ctx, m);
  const p = myParticipant(ctx, m);
  if (!isHostLike(ctx, m) && !(m.status === "LIVE" && p && p.connectionStatus !== "REMOVED")) throw notFound("Chat");
  const rows = await db.videoChatMessage.findMany({ where: { meetingId: m.id, deletedAt: null }, orderBy: { createdAt: "asc" }, take: 500 });
  return rows.map((r) => ({ id: r.id, sender: r.senderName, senderId: r.senderUserId, message: r.message, at: r.createdAt.toISOString() }));
}

export async function deleteChat(ctx: AuthContext, idOrPublicId: string, messageId: string) {
  const m = await loadMeeting(idOrPublicId);
  if (!isModerator(ctx, m)) throw forbidden("Only the host and moderators can remove messages.");
  const msg = await db.videoChatMessage.findFirst({ where: { id: messageId, meetingId: m.id, deletedAt: null } });
  if (!msg) throw notFound("Message");
  await db.videoChatMessage.update({ where: { id: msg.id }, data: { deletedAt: new Date(), deletedById: ctx.user.id } });
  await (await videoProvider()).sendData(m.roomName, "chat-delete", { id: msg.id }).catch(() => undefined);
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "video.chat.delete", resourceType: "videoMeeting", resourceId: m.id, summary: `${m.publicId}: message from ${msg.senderName} removed` });
}
