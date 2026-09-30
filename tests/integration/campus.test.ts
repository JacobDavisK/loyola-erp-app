import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { applicationByToken, enrolApplicant, makeOffers, respondToOffer, submitApplication, verifyApplication } from "@/server/services/admissions";
import { publishAnnouncement, visibleAnnouncements } from "@/server/services/announcements";
import { assignTicket, loadTicketFor, raiseTicket, rateTicket, replyTicket, setTicketStatus } from "@/server/services/helpdesk";
import { addCopies, issueCopy, placeHold, returnCopy, saveItem } from "@/server/services/library";
import { applyToDrive, saveDrive, updateApplication } from "@/server/services/placements";
import { allocateBed, issuePass, vacateBed } from "@/server/services/residence";
import { as } from "./helpers";

const DAY = 86_400_000;

describe("library", () => {
  it("issues within limits, respects holds, fines late returns and invoices student fines", async () => {
    const lib = await as("librarian");
    const item = await saveItem(lib, null, { title: "Compilers: Principles, Techniques and Tools", authors: "A. V. Aho et al.", isbn: "978-0321486813", year: 2006 });
    const [acc] = await addCopies(lib, item.id, { count: 1, location: "Stack 005" });
    const st = await db.student.findFirstOrThrow({ where: { status: "ACTIVE", libraryLoans: { none: {} } }, orderBy: { studentNo: "desc" } });
    const loan = await issueCopy(lib, { accessionNo: acc, borrower: st.studentNo });
    await expect(issueCopy(lib, { accessionNo: acc, borrower: st.studentNo })).rejects.toThrow(/on loan/);
    // A second reader asks for the title; only they can borrow it next.
    await placeHold(await as("faculty.cs1"), item.id);
    // Make it three days overdue, then return it.
    await db.libraryLoan.update({ where: { id: loan.id }, data: { issuedAt: new Date(Date.now() - 20 * DAY), dueAt: new Date(Date.now() - 3 * DAY) } });
    const r = await returnCopy(lib, { accessionNo: acc });
    expect(r.fine).toBe(600); // 3 days × 2.00
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: r.invoiceId! } });
    expect(inv.sourceType).toBe("libraryLoan");
    expect(Number(inv.total)).toBe(6);
    // The unpaid fine now blocks further borrowing, and the hold keeps the copy for the faculty member.
    await expect(issueCopy(lib, { accessionNo: acc, borrower: st.studentNo })).rejects.toThrow(/unpaid library fines|on hold/);
    const cs1 = await db.employee.findFirstOrThrow({ where: { user: { email: "faculty.cs1@example.edu" } } });
    await issueCopy(lib, { accessionNo: acc, borrower: cs1.employeeNo });
    await expect(issueCopy(await as("student"), { accessionNo: acc, borrower: st.studentNo })).rejects.toThrow(/permission/);
  });
});

describe("hostel & transport", () => {
  it("allocates beds within capacity and gender rules, raising the hostel fee", async () => {
    const w = await as("warden");
    const hostel = await db.hostel.findFirstOrThrow({ where: { code: "GH1" } });
    const room = await db.hostelRoom.create({ data: { hostelId: hostel.id, number: "T01", capacity: 1 } });
    const women = await db.student.findMany({ where: { status: "ACTIVE", gender: "FEMALE", hostelAllocations: { none: {} } }, take: 2 });
    const man = await db.student.findFirstOrThrow({ where: { status: "ACTIVE", gender: "MALE", hostelAllocations: { none: {} } } });
    await expect(allocateBed(w, { studentNo: man.studentNo, roomId: room.id, fromDate: "2026-10-01" })).rejects.toThrow(/female hostel/);
    const a = await allocateBed(w, { studentNo: women[0].studentNo, roomId: room.id, fromDate: "2026-10-01" });
    expect((await db.hostelAllocation.findUniqueOrThrow({ where: { id: a.id } })).invoiceId).toBeTruthy();
    await expect(allocateBed(w, { studentNo: women[1].studentNo, roomId: room.id, fromDate: "2026-10-01", raiseFee: false })).rejects.toThrow(/room is full/);
    await expect(allocateBed(w, { studentNo: women[0].studentNo, roomId: room.id, fromDate: "2026-10-01" })).rejects.toThrow(/already has a bed/);
    await vacateBed(w, a.id, { date: "2026-10-05", reason: "Moved to day scholar" });
    await allocateBed(w, { studentNo: women[1].studentNo, roomId: room.id, fromDate: "2026-10-06", raiseFee: false });
  });

  it("issues passes for valid stops without overlap", async () => {
    const t = await as("transport");
    const route = await db.transportRoute.findFirstOrThrow({ where: { code: "R1" } });
    const st = await db.student.findFirstOrThrow({ where: { status: "ACTIVE", transportPasses: { none: {} } } });
    await expect(issuePass(t, { studentNo: st.studentNo, routeId: route.id, stop: "Nowhere", validFrom: "2026-10-01", validTo: "2026-12-31" })).rejects.toThrow(/not a stop/);
    await issuePass(t, { studentNo: st.studentNo, routeId: route.id, stop: "Civil Lines", validFrom: "2026-10-01", validTo: "2026-12-31" });
    await expect(issuePass(t, { studentNo: st.studentNo, routeId: route.id, stop: "Civil Lines", validFrom: "2026-11-01", validTo: "2027-01-31", raiseFee: false })).rejects.toThrow(/already has a pass/);
  });
});

describe("helpdesk", () => {
  it("runs a ticket through reply, resolution and rating, hiding internal notes", async () => {
    const me = await as("faculty.com1");
    const agent = await as("helpdesk");
    const t = await raiseTicket(me, { category: "it", subject: "E-mail quota exceeded", description: "My mailbox says it is full and I cannot receive mail.", priority: "URGENT" });
    expect(t.priority).toBe("HIGH"); // requesters cannot self-declare urgent
    await expect(loadTicketFor(await as("faculty.cs1"), t.id)).rejects.toThrow(/not found/);
    await assignTicket(agent, t.id, agent.user.id);
    await replyTicket(agent, t.id, { body: "Checked: quota raised to 50 GB.", internal: false });
    await replyTicket(agent, t.id, { body: "Internal: user had 12 GB of old attachments.", internal: true });
    const seen = await loadTicketFor(me, t.id);
    expect(seen.ticket.messages.some((m) => m.internal)).toBe(false);
    expect(seen.ticket.messages).toHaveLength(2);
    await setTicketStatus(agent, t.id, "RESOLVED");
    await expect(setTicketStatus(me, t.id, "OPEN")).rejects.toThrow();
    await rateTicket(me, t.id, 5);
    const done = await db.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(done.status).toBe("CLOSED");
    expect(done.firstResponseAt).toBeTruthy();
  });
});

describe("announcements", () => {
  it("reaches only the intended audience", async () => {
    const reg = await as("registrar");
    const cs = await db.department.findFirstOrThrow({ where: { code: "CS" } });
    const a = await publishAnnouncement(reg, null, { title: "CS lab closed on Friday", body: "The CS labs are closed for maintenance.", audience: "STUDENTS", departmentId: cs.id });
    expect((await visibleAnnouncements(await as("student"))).some((x) => x.id === a.id)).toBe(true);
    expect((await visibleAnnouncements(await as("faculty.cs1"))).some((x) => x.id === a.id)).toBe(false);
    await expect(publishAnnouncement(await as("faculty.cs1"), null, { title: "x".repeat(5), body: "y".repeat(5), audience: "EVERYONE" })).rejects.toThrow();
  });
});

describe("admissions", () => {
  it("takes a public application, verifies, offers by merit, accepts and enrols", async () => {
    const cycle = await db.admissionCycle.findFirstOrThrow({ where: { isPublic: true }, include: { seats: true } });
    const seat = cycle.seats[0];
    const base = { cycleId: cycle.id, programId: seat.programId, phone: "+91 90000 11111", dateOfBirth: "2008-04-12", qualifyingExam: "CBSE Class XII", declaration: true as const };
    const app = await submitApplication({ ...base, firstName: "Test", lastName: "Applicant", email: "test.applicant@example.com", qualifyingPercent: 99 }, "10.0.0.1");
    await expect(submitApplication({ ...base, firstName: "Test", lastName: "Applicant", email: "test.applicant@example.com", qualifyingPercent: 99 }, "10.0.0.2")).rejects.toThrow(/already exists/);
    await expect(applicationByToken(app.number, "wrong-token")).rejects.toThrow(/not found/);
    expect((await applicationByToken(app.number, app.token)).status).toBe("SUBMITTED");
    expect(await db.emailOutbox.count({ where: { to: "test.applicant@example.com" } })).toBe(1);

    const off = await as("admissions");
    await verifyApplication(off, app.id, { decision: "verify", entranceScore: 98 });
    const verified = await db.admissionApplication.findUniqueOrThrow({ where: { id: app.id } });
    expect(verified.meritScore).toBe(98.6);
    await makeOffers(off, cycle.id, seat.programId);
    expect((await db.admissionApplication.findUniqueOrThrow({ where: { id: app.id } })).status).toBe("OFFERED"); // top of the merit list
    const offeredCount = await db.admissionApplication.count({ where: { cycleId: cycle.id, programId: seat.programId, status: "OFFERED" } });
    expect(offeredCount).toBeLessThanOrEqual(seat.seats);
    await respondToOffer(app.number, app.token, true);
    const s = await enrolApplicant(off, app.id);
    expect(s.firstName).toBe("Test");
    expect(s.batchId).toBe(seat.batchId);
    expect((await db.admissionApplication.findUniqueOrThrow({ where: { id: app.id } })).studentId).toBe(s.id);
  });
});

describe("placements", () => {
  it("enforces eligibility and records selections", async () => {
    const po = await as("placement");
    const company = await db.company.findFirstOrThrow({ where: { name: "Federal Bank" } });
    const drive = await saveDrive(po, null, { companyId: company.id, title: "Federal Bank PO 2026", role: "Probationary Officer", description: "Banking operations role for graduates.", ctc: 450000, applyBy: new Date(Date.now() + 10 * DAY), status: "OPEN", eligibility: { programCodes: ["BCOM"] } });
    await expect(applyToDrive(await as("student"), drive.id)).rejects.toThrow(/Programme not eligible/);
    const open = await saveDrive(po, drive.id, { companyId: company.id, title: "Federal Bank PO 2026", role: "Probationary Officer", description: "Banking operations role for graduates.", ctc: 450000, applyBy: new Date(Date.now() + 10 * DAY), status: "OPEN", eligibility: {} });
    const app = await applyToDrive(await as("student"), open.id);
    await expect(applyToDrive(await as("student"), open.id)).rejects.toThrow(/already applied/);
    await updateApplication(po, app.id, { status: "SELECTED" });
    const done = await db.placementApplication.findUniqueOrThrow({ where: { id: app.id } });
    expect(Number(done.offerCtc)).toBe(450000);
  });
});
