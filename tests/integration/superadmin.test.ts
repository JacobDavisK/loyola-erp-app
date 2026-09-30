import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS } from "@/lib/domain/permissions";
import { can } from "@/server/auth/current";
import { db } from "@/server/db";
import { runReport } from "@/server/reports/engine";
import { requestAccess } from "@/server/services/access-requests";
import { courseSpace } from "@/server/services/lms";
import { portalSubject } from "@/server/services/portal";
import { decideTask } from "@/server/services/workflow";
import { DATASETS } from "@/server/reports/datasets";
import { as } from "./helpers";

describe("Super Admin", () => {
  it("holds every permission, globally", async () => {
    const admin = await as("admin");
    for (const p of ALL_PERMISSIONS) expect(can(admin, p)).toBe(true);
    for (const d of DATASETS) expect((await runReport(admin, { dataset: d.key, columns: [d.fields[0].key], limit: 1 })).columns).toHaveLength(1);
  });

  it("can stand in for any approver, but never on its own request", async () => {
    const admin = await as("admin");
    const role = await db.role.findUniqueOrThrow({ where: { key: "MODERATOR" } });
    const cs = await db.department.findFirstOrThrow({ where: { code: "CS" } });
    const inst = await requestAccess(await as("faculty.cs2"), { roleId: role.id, scopeType: "department", scopeId: cs.id, reason: "Moderating the laboratory examinations this term." });
    const task = await db.workflowTask.findFirstOrThrow({ where: { instanceId: inst.id, status: "PENDING" } });
    expect(task.assigneeId).not.toBe(admin.user.id);
    await decideTask(admin, task.id, { decision: "approve", comment: "Approved centrally" });
    expect((await db.workflowTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("APPROVED");
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "workflow.approve", actorId: admin.user.id }, orderBy: { createdAt: "desc" } });
    expect(log.summary).toMatch(/Super Admin in place of the assignee/);

    const own = await requestAccess(admin, { roleId: role.id, scopeType: "department", scopeId: cs.id, reason: "Testing that nobody approves their own request." });
    const ownTask = await db.workflowTask.findFirst({ where: { instanceId: own.id, status: "PENDING" } });
    if (ownTask) await expect(decideTask(admin, ownTask.id, { decision: "approve" })).rejects.toThrow(/not found/i);
  });

  it("teaches any class and can open any student's portal", async () => {
    const admin = await as("admin");
    const o = await db.courseOffering.findFirstOrThrow({ where: { term: { isCurrent: true } } });
    expect((await courseSpace(admin, o.id)).role).toBe("teacher");
    const st = await db.student.findFirstOrThrow({ where: { status: "ACTIVE" } });
    const view = await portalSubject(admin, st.studentNo);
    expect(view.student.id).toBe(st.id);
    expect(view.viewAs).toBe(true);
    // Ordinary staff still cannot.
    await expect(portalSubject(await as("registrar"), st.id)).rejects.toThrow();
  });
});
