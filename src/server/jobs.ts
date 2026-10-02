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
import { applyRetention } from "@/server/services/privacy";
import { computeRisks } from "@/server/services/success";
import { purgeProctorFrames } from "@/server/services/proctoring";
import { dispatchNotifications } from "@/server/services/messaging";
import { escalateOverdueGrievances } from "@/server/services/grievances";
import { sendEventReminders } from "@/server/services/campus-events";
import { deliverWebhooks } from "@/server/services/webhooks";

defineJob("workflow.escalate", async () => ({ escalated: await escalateOverdueTasks() }));
defineJob("reminders.deadlines", async () => ({ sent: await sendDeadlineReminders() }));
defineJob("announcements.dispatch", async () => ({ notified: await dispatchDueAnnouncements() }));
defineJob("admissions.expireOffers", async () => ({ lapsed: await expireOffers() }));
defineJob("library.reminders", async () => ({ sent: await sendLibraryReminders() }));
defineJob("privacy.retention", async () => ({ removed: await applyRetention() }));
defineJob("success.risk", async () => computeRisks());
defineJob("proctoring.purge", async () => ({ removed: await purgeProctorFrames() }));
defineJob("messaging.dispatch", async () => dispatchNotifications());
defineJob("grievance.escalate", async () => ({ escalated: await escalateOverdueGrievances() }));
defineJob("events.reminders", async () => ({ sent: await sendEventReminders() }));
defineJob("webhooks.deliver", async () => deliverWebhooks());
