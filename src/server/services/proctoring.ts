import "server-only";
import { z } from "zod";
import { type AuthContext } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { courseSpace } from "@/server/services/lms";
import { getSetting } from "@/server/services/settings";
import { saveFile, signedAssetUrl } from "@/server/storage";

/**
 * Remote proctoring for online quizzes. A quiz can be unproctored, BASIC (the browser reports leaving
 * the quiz tab, leaving full screen, copy and paste) or WEBCAM (additionally a webcam frame every few
 * minutes). The student accepts a notice before starting; events are stored append-only; the teacher
 * sees an integrity summary per attempt and decides. Nothing is decided automatically, and no
 * biometric matching is done on the frames.
 */

export const PROCTOR_KINDS = ["TAB_HIDDEN", "WINDOW_BLUR", "FULLSCREEN_EXIT", "COPY", "PASTE", "CONTEXT_MENU", "WEBCAM_DENIED", "WEBCAM_FRAME", "RESUMED"] as const;
export const PROCTOR_LABEL: Record<(typeof PROCTOR_KINDS)[number], string> = {
  TAB_HIDDEN: "Left the quiz tab", WINDOW_BLUR: "Switched to another window", FULLSCREEN_EXIT: "Left full screen", COPY: "Copied text", PASTE: "Pasted text",
  CONTEXT_MENU: "Opened the context menu", WEBCAM_DENIED: "Webcam unavailable or denied", WEBCAM_FRAME: "Webcam frame", RESUMED: "Returned to the quiz",
};
const MAX_EVENTS = 300;

async function proctoredAttempt(ctx: AuthContext, attemptId: string) {
  const a = await db.quizAttempt.findUnique({ where: { id: attemptId }, include: { quiz: { select: { proctoring: true } }, _count: { select: { proctorEvents: true } } } });
  if (!a || !ctx.subject.studentId || a.studentId !== ctx.subject.studentId) throw notFound("Attempt");
  if (a.quiz.proctoring === "NONE") throw invalid("This quiz is not proctored.");
  if (a.status !== "IN_PROGRESS") throw workflowError("The attempt has been submitted.");
  return a;
}

export async function recordProctorEvents(ctx: AuthContext, attemptId: string, raw: unknown) {
  const a = await proctoredAttempt(ctx, attemptId);
  const events = z.array(z.object({ kind: z.enum(PROCTOR_KINDS).exclude(["WEBCAM_FRAME"]), detail: z.string().max(200).nullable().optional(), at: z.coerce.date() })).max(50).parse(raw);
  const room = Math.max(0, MAX_EVENTS - a._count.proctorEvents);
  const now = Date.now();
  const rows = events.slice(0, room).map((e) => ({ attemptId, kind: e.kind, detail: e.detail ?? null, at: Math.abs(e.at.getTime() - now) < 10 * 60_000 ? e.at : new Date(now) }));
  if (rows.length) await db.proctorEvent.createMany({ data: rows });
  return rows.length;
}

export async function uploadProctorFrame(ctx: AuthContext, attemptId: string, form: FormData) {
  const a = await proctoredAttempt(ctx, attemptId);
  if (a.quiz.proctoring !== "WEBCAM") throw invalid("This quiz does not use the webcam.");
  const file = form.get("frame");
  if (!(file instanceof File) || file.size === 0) throw invalid("No frame received.");
  if (file.size > 400_000) throw invalid("The frame is too large.");
  const frames = await db.proctorEvent.count({ where: { attemptId, kind: "WEBCAM_FRAME" } });
  if (frames >= 120) return null;
  const asset = await saveFile({ data: Buffer.from(await file.arrayBuffer()), name: `frame-${attemptId}-${frames + 1}.jpg`, kind: "OTHER", ownerId: ctx.user.id });
  await db.proctorEvent.create({ data: { attemptId, kind: "WEBCAM_FRAME", fileId: asset.id } });
  return asset.id;
}

/** Integrity summary of a quiz's attempts, for its teachers. */
export async function integrityReport(ctx: AuthContext, quizId: string) {
  const quiz = await db.quiz.findUnique({ where: { id: quizId } });
  if (!quiz) throw notFound("Quiz");
  const s = await courseSpace(ctx, quiz.offeringId);
  if (s.role !== "teacher" && s.role !== "manager") throw forbidden();
  const cfg = await getSetting("proctoring");
  const attempts = await db.quizAttempt.findMany({
    where: { quizId },
    orderBy: [{ studentId: "asc" }, { attemptNo: "asc" }],
    include: { student: { select: { studentNo: true, firstName: true, lastName: true } }, proctorEvents: { orderBy: { at: "asc" } } },
  });
  const frameIds = attempts.flatMap((a) => a.proctorEvents.filter((e) => e.fileId).map((e) => e.fileId!));
  const live = new Set((await db.fileAsset.findMany({ where: { id: { in: frameIds }, deletedAt: null }, select: { id: true } })).map((f) => f.id));
  return {
    quiz,
    threshold: cfg.flagThreshold,
    attempts: attempts.map((a) => {
      const counts: Record<string, number> = {};
      for (const e of a.proctorEvents) if (e.kind !== "WEBCAM_FRAME" && e.kind !== "RESUMED") counts[e.kind] = (counts[e.kind] ?? 0) + 1;
      const incidents = Object.values(counts).reduce((x, y) => x + y, 0);
      return {
        id: a.id, attemptNo: a.attemptNo, status: a.status, score: a.score, maxScore: a.maxScore, student: a.student, consentAt: a.proctorConsentAt,
        counts, incidents, flagged: incidents >= cfg.flagThreshold,
        timeline: a.proctorEvents.filter((e) => e.kind !== "WEBCAM_FRAME").map((e) => ({ kind: e.kind, detail: e.detail, at: e.at })),
        frames: a.proctorEvents.filter((e) => e.fileId && live.has(e.fileId)).map((e) => ({ at: e.at, url: signedAssetUrl(e.fileId!, 900) })),
      };
    }),
  };
}

/** Retention: remove webcam frames older than the configured days (the event row stays as evidence that a frame was taken). */
export async function purgeProctorFrames(now = new Date()): Promise<number> {
  const { retainDays } = await getSetting("proctoring");
  const old = await db.proctorEvent.findMany({ where: { kind: "WEBCAM_FRAME", fileId: { not: null }, at: { lt: new Date(now.getTime() - retainDays * 86_400_000) } }, select: { fileId: true } });
  const ids = old.map((o) => o.fileId!);
  if (!ids.length) return 0;
  const assets = await db.fileAsset.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, storageKey: true } });
  const { storage } = await import("@/server/storage");
  for (const a of assets) await storage.remove(a.storageKey);
  await db.fileAsset.updateMany({ where: { id: { in: assets.map((a) => a.id) } }, data: { deletedAt: now } });
  return assets.length;
}
