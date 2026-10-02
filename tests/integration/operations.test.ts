import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { depreciationSchedule, disposeAsset, postDepreciation, saveAsset } from "@/server/services/assets";
import { approveBudget, budgetReport, saveBudget, setBudgetLine } from "@/server/services/budgets";
import { recordVisit, visitsFor } from "@/server/services/clinic";
import { decideBooking, requestBooking } from "@/server/services/facilities";
import { applyOutpass, checkInVisitor, decideOutpass, gateMove, preRegisterVisitor } from "@/server/services/gate";
import { countStock, issueStock, stockLevels } from "@/server/services/inventory";
import { approveVendorInvoice, createOrder, payVendorInvoice, receiveGoods, recordVendorInvoice, saveRequest, submitRequest } from "@/server/services/procurement";
import { decideTask } from "@/server/services/workflow";
import { as } from "./helpers";

const DAY = 86_400_000;
const sumAccount = async (code: string, sourceType?: string) => {
  const r = await db.journalLine.aggregate({ where: { account: { code }, ...(sourceType ? { entry: { sourceType } } : {}) }, _sum: { debit: true, credit: true } });
  return Number(r._sum.debit ?? 0) - Number(r._sum.credit ?? 0);
};

describe("purchasing", () => {
  it("runs request → approval → order → receipt → bill → payment, against the budget", async () => {
    const hod = await as("hod.cs");
    const cs = await db.department.findUniqueOrThrow({ where: { code: "CS" } });
    const line = await db.budgetLine.findFirstOrThrow({ where: { budget: { departmentId: cs.id, status: "APPROVED" }, account: { code: "1300" } } });
    const toner = await db.stockItem.findUniqueOrThrow({ where: { code: "IT-TNR" } });
    const before = (await budgetReport(hod, line.budgetId)).lines.find((l) => l.line.id === line.id)!;

    // More than the line has left is refused at submission.
    const big = await saveRequest(hod, null, { departmentId: cs.id, title: "Too much toner", justification: "Testing the budget check on submission.", budgetLineId: line.id, lines: [{ kind: "STOCK", description: toner.name, itemId: toner.id, quantity: 1000, unit: "nos", estUnitPrice: 3000 }] });
    await expect(submitRequest(hod, big.id)).rejects.toThrow(/available/);

    const pr = await saveRequest(hod, null, { departmentId: cs.id, title: "Toner for department printers", justification: "Toner for the six department laser printers for the semester.", budgetLineId: line.id, lines: [{ kind: "STOCK", description: toner.name, itemId: toner.id, quantity: 20, unit: "nos", estUnitPrice: 3000 }] });
    await submitRequest(hod, pr.id);
    // The HoD raised it, so it goes straight to the Finance Officer (60,000 ≥ 50,000).
    const inst = await db.workflowInstance.findUniqueOrThrow({ where: { id: (await db.purchaseRequest.findUniqueOrThrow({ where: { id: pr.id } })).workflowId! } });
    const tasks = await db.workflowTask.findMany({ where: { instanceId: inst.id, status: "PENDING" }, include: { assignee: true } });
    expect(tasks.map((t) => t.assignee.email)).toEqual(["finance@example.edu"]);
    const committed = (await budgetReport(hod, line.budgetId)).lines.find((l) => l.line.id === line.id)!;
    expect(committed.committed - before.committed).toBe(6_000_000);
    await decideTask(await as("finance"), tasks[0].id, { decision: "approve" });
    expect((await db.purchaseRequest.findUniqueOrThrow({ where: { id: pr.id } })).status).toBe("APPROVED");

    const purchase = await as("purchase");
    const vendor = await db.vendor.findFirstOrThrow({ where: { name: "Chennai Computer Systems" } });
    const prLine = await db.purchaseRequestLine.findFirstOrThrow({ where: { requestId: pr.id } });
    const po = await createOrder(purchase, pr.id, { vendorId: vendor.id, taxPercent: 18, prices: { [prLine.id]: 2800 } });
    expect(Number(po.total)).toBeCloseTo(20 * 2800 * 1.18, 2);
    const store = await db.store.findUniqueOrThrow({ where: { name: "Central Store" } });
    const poLine = await db.purchaseOrderLine.findFirstOrThrow({ where: { poId: po.id } });
    await expect(receiveGoods(await as("stores"), po.id, { storeId: store.id, quantities: { [poLine.id]: 25 } })).rejects.toThrow(/More received/);
    await receiveGoods(await as("stores"), po.id, { storeId: store.id, quantities: { [poLine.id]: 12 } });
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("PART_RECEIVED");
    await receiveGoods(await as("stores"), po.id, { storeId: store.id, quantities: { [poLine.id]: 8 } });
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("RECEIVED");
    const tonerRow = (await stockLevels()).rows.find((r) => r.item.id === toner.id)!;
    expect(tonerRow.total).toBe(24);

    const accounts = await as("accounts");
    await expect(recordVendorInvoice(accounts, po.id, { invoiceNo: "CCS/1", invoiceDate: "2026-09-30", amount: 999_999 })).rejects.toThrow(/exceed/);
    const bill = await recordVendorInvoice(accounts, po.id, { invoiceNo: "CCS/1", invoiceDate: "2026-09-30", amount: 66_080 });
    const ap = await sumAccount("2400");
    await expect(payVendorInvoice(accounts, bill.id, "NEFT 1")).rejects.toThrow(/Approve/);
    await approveVendorInvoice(accounts, bill.id);
    expect(await sumAccount("2400")).toBeCloseTo(ap - 66_080, 2);
    const after = (await budgetReport(hod, line.budgetId)).lines.find((l) => l.line.id === line.id)!;
    expect(after.actual - before.actual).toBe(6_608_000);
    expect(after.committed).toBe(before.committed);
    await payVendorInvoice(accounts, bill.id, "NEFT UTIB000123");
    expect(await sumAccount("2400")).toBeCloseTo(ap, 2);
  });

  it("needs another officer to approve a budget, then freezes it", async () => {
    const finance = await as("finance");
    const b = await saveBudget(finance, { fiscalYear: "2027-28", departmentId: null });
    const acc = await db.ledgerAccount.findUniqueOrThrow({ where: { code: "5310" } });
    await setBudgetLine(finance, b.id, { accountId: acc.id, amount: 50_000 });
    await expect(approveBudget(finance, b.id)).rejects.toThrow(/Another officer/);
    await approveBudget(await as("admin"), b.id);
    await expect(setBudgetLine(finance, b.id, { accountId: acc.id, amount: 60_000 })).rejects.toThrow(/approved budget/);
    const income = await db.ledgerAccount.findUniqueOrThrow({ where: { code: "4100" } });
    const b2 = await saveBudget(finance, { fiscalYear: "2028-29", departmentId: null });
    await expect(setBudgetLine(finance, b2.id, { accountId: income.id, amount: 1 })).rejects.toThrow(/expense or asset/);
  });
});

describe("stores", () => {
  it("issues at average cost to a department and refuses to go below zero", async () => {
    const keeper = await as("stores");
    const markers = await db.stockItem.findUniqueOrThrow({ where: { code: "ST-WBM" } });
    const store = await db.store.findUniqueOrThrow({ where: { name: "Central Store" } });
    const com = await db.department.findUniqueOrThrow({ where: { code: "COM" } });
    const consumed = await sumAccount("5310");
    await issueStock(keeper, { itemId: markers.id, storeId: store.id, quantity: 10, departmentId: com.id });
    expect(await sumAccount("5310")).toBeCloseTo(consumed + 10 * 26.88, 2);
    await expect(issueStock(keeper, { itemId: markers.id, storeId: store.id, quantity: 10_000, departmentId: com.id })).rejects.toThrow(/Only/);
    await expect(db.stockMovement.create({ data: { itemId: markers.id, storeId: store.id, kind: "ISSUE", quantity: -10_000, unitCost: "1", createdById: keeper.user.id } })).rejects.toThrow();
    const diff = await countStock(keeper, { itemId: markers.id, storeId: store.id, counted: 65, note: "Monthly count; 5 markers dried out" });
    expect(diff).toBe(-5);
    await expect(issueStock(await as("faculty.cs1"), { itemId: markers.id, storeId: store.id, quantity: 1, departmentId: com.id })).rejects.toThrow();
  });
});

describe("assets", () => {
  it("depreciates, posts once a year by department, and books a loss on disposal", async () => {
    const estate = await as("estate");
    const cs = await db.department.findUniqueOrThrow({ where: { code: "CS" } });
    const a = await saveAsset(estate, null, { name: "Oscilloscope", category: "Lab equipment", departmentId: cs.id, purchaseDate: "2025-04-01", cost: 50_000, salvageValue: 0, usefulLifeYears: 5, method: "STRAIGHT_LINE" });
    expect(a.tag).toMatch(/^AST\/\d{4}\/\d{5}$/);
    const s = await depreciationSchedule("2025-26");
    expect(s.rows.find((r) => r.asset.id === a.id)!.charge).toBeCloseTo(10_000, 0);
    const dep = await sumAccount("5400");
    await postDepreciation(await as("finance"), "2025-26");
    expect(await sumAccount("5400")).toBeGreaterThan(dep + 9_999);
    await expect(postDepreciation(await as("finance"), "2025-26")).rejects.toThrow(/was posted/);
    const loss = await sumAccount("5410");
    await disposeAsset(estate, a.id, { date: "2026-04-01", value: 30_000, note: "Sold on buy-back to the supplier" });
    expect(await sumAccount("5410")).toBeCloseTo(loss + 10_000, 0);
    await expect(disposeAsset(estate, a.id, { date: "2026-04-02", value: 0, note: "Again, should fail" })).rejects.toThrow(/Already/);
    await expect(db.assetEvent.deleteMany({ where: { assetId: a.id } })).rejects.toThrow();
  });
});

describe("rooms", () => {
  it("refuses clashes with classes and bookings, and holds halls for approval", async () => {
    const hod = await as("hod.cs");
    const meeting = await db.classMeeting.findFirstOrThrow({ where: { roomId: { not: null }, status: "SCHEDULED", startsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" } });
    await expect(requestBooking(hod, { roomId: meeting.roomId, title: "Clashing meeting", startsAt: meeting.startsAt, endsAt: meeting.endsAt })).rejects.toThrow(/taken/);
    const room = await db.room.findUniqueOrThrow({ where: { code: "CB-12" } });
    const start = new Date(Date.now() + 40 * DAY);
    start.setUTCHours(13, 0, 0, 0);
    const b = await requestBooking(hod, { roomId: room.id, title: "Alumni meet", startsAt: start, endsAt: new Date(start.getTime() + 2 * 3_600_000) });
    expect(b.status).toBe("APPROVED");
    await expect(requestBooking(await as("faculty.cs1"), { roomId: room.id, title: "Overlap", startsAt: new Date(start.getTime() + 3_600_000), endsAt: new Date(start.getTime() + 3 * 3_600_000) })).rejects.toThrow(/taken/);
    const hall = await db.room.findUniqueOrThrow({ where: { code: "AB-301" } });
    const h = await requestBooking(hod, { roomId: hall.id, title: "Department day", startsAt: start, endsAt: new Date(start.getTime() + 3_600_000) });
    expect(h.status).toBe("REQUESTED");
    await expect(decideBooking(hod, h.id, true)).rejects.toThrow();
    await decideBooking(await as("estate"), h.id, true);
    expect((await db.facilityBooking.findUniqueOrThrow({ where: { id: h.id } })).status).toBe("APPROVED");
  });
});

describe("gate and out-passes", () => {
  it("checks in a visitor by pass code once", async () => {
    const pass = await preRegisterVisitor(await as("hod.cs"), { name: "Prof. External", phone: "+91 90000 00001", purpose: "Viva voce", expectedAt: new Date(Date.now() + 3_600_000) });
    const security = await as("security");
    await checkInVisitor(security, { passCode: pass.passCode });
    await expect(checkInVisitor(security, { passCode: pass.passCode })).rejects.toThrow(/already/);
    await expect(checkInVisitor(await as("faculty.cs1"), { passCode: "000000" })).rejects.toThrow();
  });

  it("goes from warden approval with an SMS to the guardian, to a late return", async () => {
    // The demo student lives in a hostel for this test.
    const st = await db.student.findFirstOrThrow({ where: { user: { email: "student@example.edu" } } });
    if (!(await db.hostelAllocation.findFirst({ where: { studentId: st.id, vacatedAt: null } }))) {
      const hostel = await db.hostel.findFirstOrThrow({ where: { wardenId: { not: null } } });
      const room = await db.hostelRoom.create({ data: { hostelId: hostel.id, number: "T-OUTPASS", capacity: 1 } });
      await db.hostelAllocation.create({ data: { roomId: room.id, studentId: st.id, fromDate: new Date(), allocatedById: (await as("warden")).user.id } });
    }
    const student = await as("student");
    const leave = new Date(Date.now() + 3_600_000);
    const o = await applyOutpass(student, { reason: "Family function at home", destination: "Trichy", leaveAt: leave, returnBy: new Date(leave.getTime() + DAY) });
    await expect(applyOutpass(student, { reason: "Another one", destination: "Trichy", leaveAt: leave, returnBy: new Date(leave.getTime() + DAY) })).rejects.toThrow(/open out-pass/);
    await expect(decideOutpass(await as("security"), o.id, true)).rejects.toThrow(/warden/);
    const sms = await db.messageOutbox.count({ where: { channel: "SMS" } });
    await decideOutpass(await as("warden"), o.id, true);
    expect((await db.outpass.findUniqueOrThrow({ where: { id: o.id } })).guardianNotified).toBe(true);
    expect(await db.messageOutbox.count({ where: { channel: "SMS" } })).toBe(sms + 1);
    const security = await as("security");
    expect(await gateMove(security, o.id, new Date(leave.getTime() + 600_000))).toBe("OUT");
    expect(await gateMove(security, o.id, new Date(leave.getTime() + 2 * DAY))).toBe("RETURNED");
    expect((await db.outpass.findUniqueOrThrow({ where: { id: o.id } })).late).toBe(true);
  });
});

describe("health centre", () => {
  it("keeps visits private and tells the mentor about rest without the diagnosis", async () => {
    const st = await db.student.findFirstOrThrow({ where: { user: { email: "student@example.edu" } } });
    const v = await recordVisit(await as("doctor"), { patient: "STUDENT", rollOrCode: st.studentNo, complaint: "Fever", temperature: 38.6, diagnosis: "Viral fever", restDays: 2, certificate: true });
    expect(v.vitals).toMatchObject({ temperature: 38.6 });
    const mine = await visitsFor(await as("student"), { studentId: st.id });
    expect(mine.some((x) => x.id === v.id)).toBe(true);
    await expect(visitsFor(await as("faculty.cs1"), { studentId: st.id })).rejects.toThrow();
    const notes = await db.notification.findMany({ where: { type: "clinic.rest", createdAt: { gte: v.createdAt } } });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((n) => !(n.body ?? "").includes("Viral"))).toBe(true);
    await expect(db.clinicVisit.create({ data: { complaint: "x", attendedById: v.attendedById } })).rejects.toThrow();
  });
});
