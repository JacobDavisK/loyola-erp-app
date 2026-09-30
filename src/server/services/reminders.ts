import "server-only";
import { db } from "@/server/db";
import { audit } from "@/server/services/audit";
import { usersWithPermission } from "@/server/services/directory";
import { notify } from "@/server/services/notifications";
import { getSetting } from "@/server/services/settings";

const DAY = 86_400_000;

/**
 * Deadline reminders. Idempotent per day: a reminder of a given type is not re-sent to the same
 * user for the same record within 20 hours. Schedule `npm run jobs:reminders` (cron / Task Scheduler)
 * once or twice a day.
 */
export async function sendDeadlineReminders(now = new Date()) {
  const { deadlineWarningDays } = await getSetting("workflow");
  const since = new Date(Date.now() - 20 * 3_600_000); // dedupe on wall-clock send time
  let sent = 0;

  const alreadySent = async (userId: string, type: string, link: string, title?: string) =>
    (await db.notification.count({ where: { userId, type, link, ...(title ? { title } : {}), createdAt: { gte: since } } })) > 0;

  // Setter submissions
  const open = await db.setterAssignment.findMany({
    where: { status: { in: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "RETURNED"] }, deadline: { lte: new Date(now.getTime() + deadlineWarningDays * DAY) } },
    include: { examination: { include: { course: { select: { code: true, title: true, departmentId: true } } } }, setter: { select: { name: true } } },
  });
  for (const a of open) {
    const days = Math.ceil((a.deadline.getTime() - now.getTime()) / DAY);
    const overdue = days < 0;
    const type = overdue ? "deadline.overdue" : "deadline.approaching";
    const link = "/assignments";
    const title = overdue ? `Overdue: ${a.examination.course.code} paper` : `Deadline ${days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}: ${a.examination.course.code}`;
    for (const uid of [a.setterId, a.backupSetterId].filter((x): x is string => !!x)) {
      if (await alreadySent(uid, type, link)) continue;
      await notify({ userIds: [uid], type, title, body: `${a.examination.course.title} — paper submission${overdue ? ` was due ${a.deadline.toDateString()}` : ""}.`, link });
      sent++;
    }
    if (overdue) {
      for (const uid of await usersWithPermission("assignment.manage", a.examination.course.departmentId)) {
        if (await alreadySent(uid, "deadline.overdue", "/setters?tab=deadlines", `Setter overdue: ${a.examination.course.code}`)) continue;
        await notify({ userIds: [uid], type: "deadline.overdue", title: `Setter overdue: ${a.examination.course.code}`, body: `${a.setter.name} has not submitted ${a.examination.course.title}.`, link: "/setters?tab=deadlines", email: false });
        sent++;
      }
    }
  }

  // Review stages (session deadlines)
  const stages = [
    { status: "UNDER_MODERATION" as const, field: "moderationDeadline" as const, who: "moderator" as const, label: "Moderation" },
    { status: "UNDER_SCRUTINY" as const, field: "scrutinyDeadline" as const, who: "scrutinizer" as const, label: "Scrutiny" },
  ];
  for (const st of stages) {
    const papers = await db.questionPaper.findMany({
      where: { deletedAt: null, status: st.status, examination: { session: { [st.field]: { lte: new Date(now.getTime() + deadlineWarningDays * DAY) } } } },
      include: { examination: { include: { course: { select: { code: true } }, session: true } } },
    });
    for (const p of papers) {
      const uid = st.who === "moderator" ? p.examination.moderatorId : p.examination.scrutinizerId;
      const due = p.examination.session[st.field];
      if (!uid || !due) continue;
      const link = st.who === "moderator" ? `/moderation/${p.id}` : `/scrutiny/${p.id}`;
      if (await alreadySent(uid, "deadline.approaching", link)) continue;
      const days = Math.ceil((due.getTime() - now.getTime()) / DAY);
      await notify({ userIds: [uid], type: "deadline.approaching", title: `${st.label} ${days < 0 ? "overdue" : days <= 1 ? "due tomorrow" : `due in ${days} days`}: ${p.examination.course.code}`, link });
      sent++;
    }
  }

  await audit({ action: "jobs.reminders", resourceType: "system", summary: `${sent} deadline reminder(s) sent` });
  return sent;
}
