/**
 * Scheduled job: deadline reminders (run with `npm run jobs:reminders`).
 * Uses the react-server export condition so server-only modules load outside Next.js.
 */
import "dotenv/config";
import { sendDeadlineReminders } from "@/server/services/reminders";

sendDeadlineReminders()
  .then((n) => {
    console.log(`[reminders] ${n} reminder(s) sent`);
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
