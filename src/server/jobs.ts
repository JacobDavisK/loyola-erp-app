import "server-only";
/**
 * Job and event handler registrations. Imported by the worker (scripts/worker.ts).
 * Modules that define background jobs with `defineJob` at module level are imported for their side effect.
 */
import { defineJob } from "@/server/services/jobs";
import { sendDeadlineReminders } from "@/server/services/reminders";
import { escalateOverdueTasks } from "@/server/services/workflow";
import "@/server/services/student-import";
import { expireOffers } from "@/server/services/admissions";
import { dispatchDueAnnouncements } from "@/server/services/announcements";
import { sendLibraryReminders } from "@/server/services/library";

defineJob("workflow.escalate", async () => ({ escalated: await escalateOverdueTasks() }));
defineJob("reminders.deadlines", async () => ({ sent: await sendDeadlineReminders() }));
defineJob("announcements.dispatch", async () => ({ notified: await dispatchDueAnnouncements() }));
defineJob("admissions.expireOffers", async () => ({ lapsed: await expireOffers() }));
defineJob("library.reminders", async () => ({ sent: await sendLibraryReminders() }));
