import { describe, expect, it } from "vitest";
import { can } from "@/server/auth/current";
import { db } from "@/server/db";
import { requestAccess } from "@/server/services/access-requests";
import { grantRole } from "@/server/services/admin";
import { emitEvent, onEvent, processEvents } from "@/server/services/events";
import { defineJob, enqueueJob, runNextJob } from "@/server/services/jobs";
import { nextNumber } from "@/server/services/sequence";
import { cancelWorkflow, decideTask, delegateTask, escalateOverdueTasks, saveDelegation } from "@/server/services/workflow";
import { as } from "./helpers";

const pendingTasks = (instanceId: string) => db.workflowTask.findMany({ where: { instanceId, status: "PENDING" }, include: { assignee: { select: { email: true } } } });
const moderatorRole = () => db.role.findUniqueOrThrow({ where: { key: "MODERATOR" } });
const deptId = async (code: string) => (await db.department.findUniqueOrThrow({ where: { code } })).id;

describe("scoped grants (ABAC)", () => {
  it("a faculty-level Dean sees every department under the faculty and nothing else", async () => {
    const dean = await as("dean.science");
    expect(can(dean, "student.view", await deptId("CS"))).toBe(true);
    expect(can(dean, "student.view", await deptId("PHY"))).toBe(true);
    expect(can(dean, "student.view", await deptId("COM"))).toBe(false);
  });

  it("a campus Principal sees only departments on that campus", async () => {
    const p = await as("principal.city");
    expect(can(p, "student.view", await deptId("COM"))).toBe(true);
    expect(can(p, "student.view", await deptId("CS"))).toBe(false);
  });

  it("expired grants stop working", async () => {
    const admin = await as("admin");
    const target = await db.user.findUniqueOrThrow({ where: { email: "faculty.com1@example.edu" } });
    const role = await moderatorRole();
    const g = await grantRole(admin, target.id, role.id, { type: "own", validUntil: new Date(Date.now() + 60_000) });
    expect(can(await as("faculty.com1"), "moderation.perform")).toBe(true);
    await db.userRole.update({ where: { id: g.id }, data: { validUntil: new Date(Date.now() - 1000) } });
    expect(can(await as("faculty.com1"), "moderation.perform")).toBe(false);
  });
});

describe("workflow engine — access requests", () => {
  it("runs HoD → security approval, then grants the role", async () => {
    const requester = await as("setter2");
    const role = await moderatorRole();
    const inst = await requestAccess(requester, { roleId: role.id, scopeType: "department", scopeId: await deptId("CS"), reason: "Internal moderation duties for the practical examinations." });
    expect(inst.status).toBe("IN_PROGRESS");
    let tasks = await pendingTasks(inst.id);
    expect(tasks.map((t) => t.assignee.email)).toEqual(["hod.cs@example.edu"]);

    // Only the assignee (or the Super Admin standing in) can decide.
    await expect(decideTask(await as("registrar"), tasks[0].id, { decision: "approve" })).rejects.toThrow(/not found/i);
    // Rejecting requires a reason.
    await expect(decideTask(await as("hod.cs"), tasks[0].id, { decision: "reject" })).rejects.toThrow(/reason/i);

    expect((await decideTask(await as("hod.cs"), tasks[0].id, { decision: "approve", comment: "Agreed" })).status).toBe("IN_PROGRESS");
    tasks = await pendingTasks(inst.id);
    expect(tasks.map((t) => t.assignee.email).sort()).toEqual(["admin@example.edu", "itadmin@example.edu"]);

    // A task that was decided cannot be decided twice.
    const hodTask = await db.workflowTask.findFirstOrThrow({ where: { instanceId: inst.id, stepKey: "hod" } });
    await expect(decideTask(await as("hod.cs"), hodTask.id, { decision: "approve" })).rejects.toThrow(/already/i);

    const itTask = tasks.find((t) => t.assignee.email === "itadmin@example.edu")!;
    expect((await decideTask(await as("itadmin"), itTask.id, { decision: "approve" })).status).toBe("APPROVED");
    // ANY mode: the other security task is no longer pending.
    expect(await pendingTasks(inst.id)).toHaveLength(0);
    expect(can(await as("setter2"), "moderation.perform")).toBe(true);

    const history = await db.workflowAction.findMany({ where: { instanceId: inst.id }, orderBy: { createdAt: "asc" } });
    expect(history.map((h) => h.action)).toEqual(["start", "approve", "approve", "complete"]);
    const audit = await db.auditLog.findFirst({ where: { action: "role.grant", resourceId: requester.user.id }, orderBy: { id: "desc" } });
    expect(audit?.summary).toMatch(/approved access request/);
    // History is append-only at the database level.
    await expect(db.workflowAction.update({ where: { id: history[0].id }, data: { comment: "tampered" } })).rejects.toThrow();
  });

  it("skips a step when the requester is its only approver (no self-approval)", async () => {
    const hod = await as("hod.cs");
    const role = await db.role.findUniqueOrThrow({ where: { key: "SCRUTINY_OFFICER" } });
    const inst = await requestAccess(hod, { roleId: role.id, scopeType: "department", scopeId: await deptId("CS"), reason: "Covering scrutiny while the officer is on leave." });
    const tasks = await pendingTasks(inst.id);
    expect(tasks.every((t) => t.stepKey === "security")).toBe(true);
    expect(tasks.some((t) => t.assignee.email === "hod.cs@example.edu")).toBe(false);
    const skip = await db.workflowAction.findFirst({ where: { instanceId: inst.id, action: "skip" } });
    expect(skip?.comment).toMatch(/only approver/);
    await cancelWorkflow(hod, inst.id, "No longer needed");
    expect((await db.workflowInstance.findUniqueOrThrow({ where: { id: inst.id } })).status).toBe("CANCELLED");
  });

  it("refuses a duplicate open request and handles return + delegation", async () => {
    const requester = await as("setter");
    const role = await moderatorRole();
    const input = { roleId: role.id, scopeType: "department", scopeId: await deptId("CS"), reason: "Moderation of first-semester internal papers." };
    const inst = await requestAccess(requester, input);
    await expect(requestAccess(requester, input)).rejects.toThrow(/already in progress/i);

    const [hodTask] = await pendingTasks(inst.id);
    // HoD delegates to a colleague, who returns the request for correction.
    const colleague = await db.user.findUniqueOrThrow({ where: { email: "dean.science@example.edu" } });
    await delegateTask(await as("hod.cs"), hodTask.id, { toUserId: colleague.id });
    const delegated = await db.workflowTask.findUniqueOrThrow({ where: { id: hodTask.id } });
    expect(delegated.assigneeId).toBe(colleague.id);
    await expect(delegateTask(await as("dean.science"), hodTask.id, { toUserId: requester.user.id })).rejects.toThrow(/other than/i);
    expect((await decideTask(await as("dean.science"), hodTask.id, { decision: "return", comment: "Please state the session." })).status).toBe("RETURNED");
    expect(await db.notification.count({ where: { userId: requester.user.id, type: "workflow.returned" } })).toBeGreaterThan(0);
  });

  it("routes new tasks to an out-of-office delegate and escalates overdue tasks", async () => {
    const hod = await as("hod.cs");
    const deputy = await db.user.findUniqueOrThrow({ where: { email: "faculty.cs2@example.edu" } });
    await saveDelegation(hod, { toUserId: deputy.id, startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 86_400_000) });
    const requester = await as("faculty.cs1");
    const role = await db.role.findUniqueOrThrow({ where: { key: "SETTER" } });
    const inst = await requestAccess(requester, { roleId: role.id, scopeType: "department", scopeId: await deptId("CS"), reason: "Setting the supplementary examination paper." });
    const [task] = await pendingTasks(inst.id);
    expect(task.assignee.email).toBe("faculty.cs2@example.edu");
    expect(task.delegatedFromId).toBe(hod.user.id);

    await db.workflowTask.update({ where: { id: task.id }, data: { dueAt: new Date(Date.now() - 1000) } });
    expect(await escalateOverdueTasks()).toBeGreaterThanOrEqual(1);
    expect((await db.workflowTask.findUniqueOrThrow({ where: { id: task.id } })).escalatedAt).not.toBeNull();
    expect(await db.workflowAction.count({ where: { instanceId: inst.id, action: "escalate" } })).toBe(1);
  });
});

describe("platform services", () => {
  it("allocates unique sequence numbers under concurrency", async () => {
    const values = await Promise.all(Array.from({ length: 20 }, () => db.$transaction((tx) => nextNumber(tx, "test.seq", { prefix: "T-", padding: 4 }))));
    expect(new Set(values).size).toBe(20);
    expect(values.sort()[0]).toBe("T-0001");
  });

  it("rolls a sequence number back with its transaction", async () => {
    await db.$transaction((tx) => nextNumber(tx, "test.rollback")).catch(() => null);
    await expect(db.$transaction(async (tx) => { await nextNumber(tx, "test.rollback"); throw new Error("abort"); })).rejects.toThrow("abort");
    expect(await db.$transaction((tx) => nextNumber(tx, "test.rollback"))).toBe("00002");
  });

  it("dispatches outbox events once and retries failing jobs", async () => {
    const seen: string[] = [];
    onEvent("TestHappened", async (e) => { seen.push(e.aggregateId); });
    await db.$transaction((tx) => emitEvent(tx, { type: "TestHappened", aggregateType: "test", aggregateId: "a1" }));
    await processEvents();
    await processEvents();
    expect(seen).toEqual(["a1"]);

    let calls = 0;
    defineJob("test.flaky", async () => {
      calls++;
      if (calls === 1) throw new Error("transient");
      return { ok: true };
    });
    const job = await enqueueJob(db, { type: "test.flaky" });
    expect(await runNextJob()).toBe(true);
    let row = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("QUEUED");
    expect(row.error).toBe("transient");
    await db.job.update({ where: { id: job.id }, data: { runAt: new Date(Date.now() - 1000) } });
    await runNextJob();
    row = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("SUCCEEDED");
    expect(row.result).toEqual({ ok: true });
  });
});
