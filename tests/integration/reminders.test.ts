import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { sendDeadlineReminders } from "@/server/services/reminders";

describe("deadline reminders", () => {
  it("notifies setters of overdue work once per day", async () => {
    const a = await db.setterAssignment.findFirstOrThrow({ where: { status: { in: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS"] } } });
    const now = new Date(a.deadline.getTime() + 2 * 86_400_000); // two days past the deadline

    const first = await sendDeadlineReminders(now);
    expect(first).toBeGreaterThan(0);
    const overdue = await db.notification.count({ where: { userId: a.setterId, type: "deadline.overdue", createdAt: { gte: new Date(Date.now() - 60_000) } } });
    expect(overdue).toBeGreaterThan(0);

    // Re-running immediately must not spam anyone.
    expect(await sendDeadlineReminders(now)).toBe(0);
  });
});
