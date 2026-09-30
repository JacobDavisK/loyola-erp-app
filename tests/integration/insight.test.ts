import { afterEach, describe, expect, it } from "vitest";
import { ALL_PERMISSIONS } from "@/lib/domain/permissions";
import { db } from "@/server/db";
import { draftAnnouncement, reportFromQuestion } from "@/server/ai/features";
import { redact, runAi, setAiProvider, type AiProvider } from "@/server/ai/gateway";
import { DATASETS } from "@/server/reports/datasets";
import { runReport } from "@/server/reports/engine";
import { enrolmentInsights, financeInsights, resultInsights } from "@/server/services/insights";
import { exportCsv, loadReportFor, reportsFor, saveReport } from "@/server/services/report-builder";
import { as } from "./helpers";

const fake = (reply: string, calls: string[] = []): AiProvider => ({
  name: "fake", model: "fake-1",
  async complete({ messages }) { calls.push(messages[0].content); return { text: reply, inputTokens: 12, outputTokens: 34 }; },
});

afterEach(() => setAiProvider(undefined));

describe("report builder", () => {
  it("reads every field of every dataset", async () => {
    const admin = await as("registrar");
    const all = { ...admin, grants: new Map(ALL_PERMISSIONS.map((p) => [p, null])) };
    for (const d of DATASETS) {
      const r = await runReport(all, { dataset: d.key, columns: d.fields.map((f) => f.key), limit: 5 });
      expect(r.columns).toHaveLength(d.fields.length);
    }
  });

  it("groups, filters, sorts and respects the caller's scope", async () => {
    const reg = await as("registrar");
    const byProg = await runReport(reg, { dataset: "students", groupBy: ["program"], aggregates: [{ field: "program", fn: "count" }], sort: { field: "count", dir: "desc" } });
    const total = byProg.rows.reduce((a, r) => a + Number(r.count), 0);
    expect(total).toBe(await db.student.count({ where: { deletedAt: null } }));
    const hod = await as("hod.commerce");
    const scoped = await runReport(hod, { dataset: "students", groupBy: ["department"], aggregates: [{ field: "x", fn: "count" }] });
    expect(scoped.rows.every((r) => r.department === "COM")).toBe(true);
    await expect(runReport(await as("faculty.cs1"), { dataset: "invoices", columns: ["number"] })).rejects.toThrow(/cannot report/);
    const overdue = await runReport(await as("finance"), { dataset: "invoices", columns: ["number", "balance", "dueDate"], filters: [{ field: "balance", op: "gt", value: 0 }, { field: "dueDate", op: "lt", value: new Date().toISOString().slice(0, 10) }], sort: { field: "balance", dir: "desc" }, limit: 10 });
    expect(overdue.rows.every((r) => Number(r.balance) > 0)).toBe(true);
    await expect(runReport(reg, { dataset: "students", columns: ["password"] })).rejects.toThrow(/Unknown field/);
  });

  it("saves, shares with per-viewer scope and exports audited CSV", async () => {
    const reg = await as("registrar");
    const r = await saveReport(reg, null, { name: "Students by department", shared: true, definition: { dataset: "students", groupBy: ["department"], aggregates: [{ field: "x", fn: "count" }] } });
    const hod = await as("hod.cs");
    expect((await reportsFor(hod)).some((x) => x.id === r.id)).toBe(true);
    const def = (await loadReportFor(hod, r.id)).definition;
    const res = await runReport(hod, def);
    expect(res.rows.every((x) => x.department === "CS")).toBe(true); // same report, the viewer's scope
    await expect(loadReportFor(await as("student"), r.id)).rejects.toThrow(/not found/); // no access to the dataset
    const { csv, rows } = await exportCsv(reg, { dataset: "students", columns: ["studentNo", "firstName"], filters: [{ field: "firstName", op: "eq", value: "=HYPERLINK(1)" }] }, "x");
    expect(rows).toBe(0);
    expect(csv.split(/\r?\n/)[0]).toBe("Student no.,First name");
    expect(await db.auditLog.count({ where: { action: "report.export", actorId: reg.user.id } })).toBeGreaterThan(0);
  });
});

describe("analytics", () => {
  it("computes sections only with permission and within scope", async () => {
    const reg = await as("registrar");
    expect((await enrolmentInsights(reg))!.active).toBeGreaterThan(50);
    expect(await financeInsights(await as("faculty.cs1"))).toBeNull();
    const fin = await financeInsights(await as("finance"));
    expect(fin!.collections).toHaveLength(12);
    expect(fin!.outstanding).toBeGreaterThan(0);
    expect((await resultInsights(reg))!.length).toBeGreaterThan(0);
  });
});

describe("AI gateway", () => {
  it("refuses plainly when no provider is configured", async () => {
    setAiProvider(null);
    await expect(runAi(await as("registrar"), "reportAssistant", { system: "s", user: "hello there" })).rejects.toThrow(/not configured/);
  });

  it("redacts identifiers, logs usage without content and enforces limits", async () => {
    expect(redact("Mail a.b@example.com or +91 98470 12345 about 25BCA0001 and EMP2201")).toBe("Mail [email] or [phone] about [student-no] and [employee-no]");
    const calls: string[] = [];
    setAiProvider(fake("ok", calls));
    const reg = await as("registrar");
    await runAi(reg, "reportAssistant", { system: "s", user: "Students like 25BCA0001 please" });
    expect(calls[0]).toContain("[student-no]");
    const log = await db.aiRequest.findFirstOrThrow({ where: { userId: reg.user.id }, orderBy: { createdAt: "desc" } });
    expect(log).toMatchObject({ status: "OK", inputTokens: 12, outputTokens: 34, provider: "fake" });
    expect(JSON.stringify(log)).not.toContain("25BCA0001");
    await expect(db.aiRequest.delete({ where: { id: log.id } })).rejects.toThrow(/not permitted/);
    await db.systemSetting.upsert({ where: { key: "ai" }, create: { key: "ai", value: { enabled: true, reportAssistant: false, feedbackDrafts: true, announcementDrafts: true, dailyRequestsPerUser: 50 } }, update: { value: { enabled: true, reportAssistant: false, feedbackDrafts: true, announcementDrafts: true, dailyRequestsPerUser: 50 } } });
    await expect(runAi(reg, "reportAssistant", { system: "s", user: "again please" })).rejects.toThrow(/switched off/);
    await db.systemSetting.delete({ where: { key: "ai" } });
  });

  it("turns a question into a validated report definition, never sending data", async () => {
    const calls: string[] = [];
    setAiProvider(fake('Here you go: {"dataset":"students","groupBy":["program"],"aggregates":[{"field":"program","fn":"count"}],"sort":{"field":"count","dir":"desc"},"limit":50}', calls));
    const def = await reportFromQuestion(await as("registrar"), "How many active students per programme?");
    expect(def.dataset).toBe("students");
    const r = await runReport(await as("registrar"), def);
    expect(r.rows.length).toBeGreaterThan(0);
    setAiProvider(fake('{"dataset":"students","columns":["salary"]}'));
    await expect(reportFromQuestion(await as("registrar"), "Show salaries of students")).rejects.toThrow(/needs changes|not valid/);
    setAiProvider(fake('{"dataset":"employees","columns":["employeeNo"]}'));
    await expect(reportFromQuestion(await as("faculty.cs1"), "List employees please")).rejects.toThrow(/cannot report/);
    setAiProvider(fake('{"title":"Campus closed","body":"The campus is closed on Friday."}'));
    expect((await draftAnnouncement(await as("registrar"), { points: "closed friday", audience: "EVERYONE" })).title).toBe("Campus closed");
    await expect(draftAnnouncement(await as("faculty.cs1"), { points: "closed friday", audience: "EVERYONE" })).rejects.toThrow();
  });
});
