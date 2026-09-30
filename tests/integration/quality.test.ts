import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { addEvidence, adoptComputed, assignMetrics, createCycle, importMetrics, loadResponseFor, reviewResponse, saveResponse, submitResponse } from "@/server/services/iqac";
import { completeProject, createProject, loadProjectFor, projectWhere, publicationWhere, recordExpense, recordSanction, savePublication, submitProject, verifyPublication } from "@/server/services/research";
import { decideTask } from "@/server/services/workflow";
import { as } from "./helpers";

const approveAll = async (resourceId: string) => {
  for (let i = 0; i < 5; i++) {
    const t = await db.workflowTask.findFirst({ where: { status: "PENDING", instance: { resourceId } }, include: { assignee: true } });
    if (!t) return;
    await decideTask(await as(t.assignee.email.replace("@example.edu", "")), t.id, { decision: "approve" });
  }
};

describe("research projects", () => {
  it("runs a proposal through clearance, sanction, spending and completion", async () => {
    const pi = await as("faculty.cs2");
    const p = await createProject(pi, { title: "Container-based labs for operating systems", abstract: "Build and evaluate reproducible container labs for OS courses.", fundingAgency: "AICTE", durationMonths: 12, budget: [{ head: "EQUIPMENT", amount: 200000 }, { head: "TRAVEL", amount: 30000 }] });
    expect(p.code).toMatch(/^RP\/\d{4}\/\d{4}$/);
    expect(Number(p.proposedAmount)).toBe(230000);
    await expect(createProject(await as("student"), { title: "x".repeat(10), abstract: "y".repeat(30), fundingAgency: "DST", durationMonths: 6, budget: [{ head: "TRAVEL", amount: 1 }] })).rejects.toThrow(/employee record/);

    await submitProject(pi, p.id);
    const first = await db.workflowTask.findFirstOrThrow({ where: { status: "PENDING", instance: { resourceId: p.id } }, include: { assignee: true } });
    expect(first.assignee.email).toBe("hod.cs@example.edu");
    await approveAll(p.id);
    expect((await db.researchProject.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("APPROVED");

    await expect(recordSanction(pi, p.id, { grantRef: "X", startDate: "2026-10-01", budget: [] })).rejects.toThrow();
    const rd = await as("research");
    await recordSanction(rd, p.id, { grantRef: "AICTE/2026/77", startDate: "2026-10-01", budget: [{ head: "EQUIPMENT", amount: 180000 }, { head: "TRAVEL", amount: 20000 }] });
    const sanctioned = await db.researchProject.findUniqueOrThrow({ where: { id: p.id } });
    expect(sanctioned.endDate?.toISOString().slice(0, 10)).toBe("2027-09-30");

    await recordExpense(pi, p.id, { head: "EQUIPMENT", amount: 150000, date: "2026-10-15", description: "Lab server purchase" });
    await expect(recordExpense(pi, p.id, { head: "EQUIPMENT", amount: 40000, date: "2026-10-16", description: "Second server" })).rejects.toThrow(/Only 30000.00 remains/);
    await expect(recordExpense(pi, p.id, { head: "MANPOWER", amount: 100, date: "2026-10-16", description: "Not budgeted" })).rejects.toThrow(/Nothing was sanctioned/);
    await expect(recordExpense(pi, p.id, { head: "EQUIPMENT", amount: -1000, date: "2026-10-16", description: "Refund from vendor" })).rejects.toThrow(/research office/);
    await recordExpense(rd, p.id, { head: "EQUIPMENT", amount: -1000, date: "2026-10-16", description: "Vendor refund credited" });
    const { utilisation } = await loadProjectFor(pi, p.id);
    expect(utilisation.spent).toBe(149000_00);
    const e = await db.projectExpense.findFirstOrThrow({ where: { projectId: p.id } });
    await expect(db.projectExpense.update({ where: { id: e.id }, data: { description: "changed" } })).rejects.toThrow(/not permitted/);

    await expect(completeProject(pi, p.id, "short")).rejects.toThrow(/Summarise/);
    await completeProject(pi, p.id, "Labs deployed for two batches; one conference paper under review.");
  });

  it("scopes project visibility", async () => {
    expect(await db.researchProject.count({ where: projectWhere(await as("faculty.com1")) })).toBeGreaterThan(0);
    const hodCom = await as("hod.commerce");
    const visible = await db.researchProject.findMany({ where: projectWhere(hodCom), include: { department: true } });
    expect(visible.some((p) => p.department?.code === "COM")).toBe(true);
    expect(visible.some((p) => p.department?.code === "CS")).toBe(false);
  });
});

describe("publications", () => {
  it("records publications with unique DOIs and lets only others verify them", async () => {
    const me = await as("faculty.cs1");
    const pub = await savePublication(me, null, { type: "JOURNAL", title: "Scheduling heuristics for battery-powered devices", venue: "Future Generation Computer Systems", year: 2026, doi: "https://doi.org/10.1016/J.FUTURE.2026.01.009", authorsText: "A. George, R. Das", indexing: "SCOPUS", authorIds: [] });
    expect(pub.doi).toBe("10.1016/j.future.2026.01.009");
    await expect(savePublication(await as("faculty.cs2"), null, { type: "JOURNAL", title: "Duplicate entry of the same paper", venue: "FGCS", year: 2026, doi: "10.1016/j.future.2026.01.009", authorsText: "R. Das" })).rejects.toThrow(/already recorded/);
    await expect(savePublication(me, null, { type: "JOURNAL", title: "Bad identifier paper", venue: "Some journal", year: 2026, doi: "12345", authorsText: "A. George" })).rejects.toThrow(/DOI/);
    await verifyPublication(await as("research"), pub.id);
    await expect(savePublication(me, pub.id, { type: "JOURNAL", title: "Changed after verification", venue: "FGCS", year: 2026, authorsText: "A. George" })).rejects.toThrow(/research office/);
    expect(await db.publication.count({ where: { AND: [{ id: pub.id }, publicationWhere(await as("faculty.com1"))] } })).toBe(0);
  });
});

describe("IQAC", () => {
  it("imports metrics, opens a cycle, assigns, computes, submits and reviews", async () => {
    const iqac = await as("iqac");
    const fw = await db.accreditationFramework.create({ data: { code: "NIRF-T", name: "NIRF (test)" } });
    await expect(importMetrics(iqac, fw.id, "1 | Teaching | N\n1.1 | Faculty PhD % | Q | 10 | no.such.source")).rejects.toThrow(/Unknown data source/);
    const imp = await importMetrics(iqac, fw.id, "1 | Teaching, learning and resources | N | 30\n1.1 | Faculty with PhD | Q | 10 | faculty.phdPercent | %\n1.2 | Best practice | N | 5");
    expect(imp).toEqual({ created: 3, updated: 0 });
    expect((await importMetrics(iqac, fw.id, "1.2 | Best practice (revised) | N | 6")).updated).toBe(1);

    const year = await db.academicYear.findFirstOrThrow({ where: { isCurrent: true } });
    await expect(createCycle(await as("registrar"), { frameworkId: fw.id, academicYearId: year.id, name: "x" })).rejects.toThrow();
    const cycle = await createCycle(iqac, { frameworkId: fw.id, academicYearId: year.id, name: "NIRF 2026 data", yearsCovered: 3 });
    expect(await db.metricResponse.count({ where: { cycleId: cycle.id } })).toBe(2); // leaves only
    await expect(createCycle(iqac, { frameworkId: fw.id, academicYearId: year.id, name: "again" })).rejects.toThrow(/already exists/);

    const hod = await as("hod.cs");
    expect((await assignMetrics(iqac, cycle.id, { codePrefix: "1", userId: hod.user.id })).assigned).toBe(2);
    const phd = await db.metricResponse.findFirstOrThrow({ where: { cycleId: cycle.id, metric: { code: "1.1" } } });
    const snap = await adoptComputed(hod, phd.id);
    expect(snap.unit).toBe("%");
    expect(typeof snap.value).toBe("number");
    await addEvidence(hod, phd.id, (() => { const f = new FormData(); f.set("label", "Faculty qualification register"); f.set("url", "https://example.edu/iqac/faculty-register"); return f; })());
    await submitResponse(hod, phd.id);
    await expect(saveResponse(hod, phd.id, { value: 1 })).rejects.toThrow(/cannot be edited/);

    const bp = await db.metricResponse.findFirstOrThrow({ where: { cycleId: cycle.id, metric: { code: "1.2" } } });
    await expect(submitResponse(hod, bp.id)).rejects.toThrow(/narrative/);
    await expect(reviewResponse(hod, phd.id, { decision: "approve" })).rejects.toThrow();
    await expect(reviewResponse(iqac, phd.id, { decision: "return" })).rejects.toThrow(/what needs to change/);
    await reviewResponse(iqac, phd.id, { decision: "approve" });
    const done = await loadResponseFor(await as("registrar"), phd.id);
    expect(done.response.status).toBe("APPROVED");
    expect(done.response.evidence).toHaveLength(1);
    expect(done.editable).toBe(false);
    await expect(loadResponseFor(await as("faculty.cs1"), phd.id)).rejects.toThrow(/not found/);
  });
});
