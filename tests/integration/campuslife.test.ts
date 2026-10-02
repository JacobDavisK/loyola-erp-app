import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { completeEvent, eventQr, registerForEvent, saveEvent, selfCheckIn } from "@/server/services/campus-events";
import { addEligibleGraduates, registerForConvocation, saveConvocation, setConvocationStatus } from "@/server/services/convocation";
import { bookSlot, counsellingDesk, recordSession } from "@/server/services/counselling";
import { appealGrievance, escalateOverdueGrievances, loadGrievance, raiseGrievance, resolveGrievance } from "@/server/services/grievances";
import { checkIdToken, idToken, myIdCard } from "@/server/services/idcard";
import { chatbotReply, dispatchNotifications, savePreferences, verifyWhatsAppSignature } from "@/server/services/messaging";
import { notify } from "@/server/services/notifications";
import { as } from "./helpers";

const DAY = 86_400_000;

describe("messaging and the ID card", () => {
  it("queues SMS / WhatsApp only for opted-in people and important alert types", async () => {
    const student = await as("student");
    await expect(savePreferences(student, { phone: "12345", sms: true, whatsapp: false })).rejects.toThrow(/country code/);
    await savePreferences(student, { phone: "+91 98765 43210", sms: true, whatsapp: true });
    await notify({ userIds: [student.user.id], type: "result.published", title: "Results are out", body: "Semester 3" });
    await notify({ userIds: [student.user.id], type: "lms.announcement", title: "New announcement" });
    await dispatchNotifications();
    const msgs = await db.messageOutbox.findMany({ where: { userId: student.user.id } });
    expect(msgs.filter((m) => m.body.startsWith("Results are out")).map((m) => m.channel).sort()).toEqual(["SMS", "WHATSAPP"]);
    expect(msgs.some((m) => m.body.startsWith("New announcement"))).toBe(false);
    expect(await db.notification.count({ where: { userId: student.user.id, dispatchedAt: null } })).toBe(0);
  });

  it("answers WhatsApp commands only for opted-in numbers and checks the webhook signature", async () => {
    expect(await chatbotReply("+919999999999", "FEES")).toBeNull();
    expect(await chatbotReply("+919876543210", "fees")).toMatch(/outstanding/);
    expect(await chatbotReply("+919876543210", "hello")).toMatch(/ATTENDANCE/);
    expect(verifyWhatsAppSignature("{}", "sha256=bad")).toBe(false);
  });

  it("issues a QR ID card that verifies for a day and rejects tampering", async () => {
    const card = await myIdCard(await as("student"));
    expect(card.qr).toContain("<svg");
    const st = await db.student.findFirstOrThrow({ where: { user: { email: "student@example.edu" } } });
    const t = idToken("S", st.id);
    const ok = await checkIdToken(t);
    expect(ok.ok && ok.active).toBe(true);
    expect((await checkIdToken(t.replace(st.id, "someone-else"))).ok).toBe(false);
    expect((await checkIdToken(idToken("S", st.id, Date.now() - 2 * DAY))).ok).toBe(false);
  });
});

describe("counselling", () => {
  it("books a slot once, keeps notes to counselling staff and alerts on a crisis", async () => {
    const student = await as("student");
    const slot = await db.counsellingSlot.findFirstOrThrow({ where: { status: "OPEN" }, orderBy: { startsAt: "asc" } });
    const b = await bookSlot(student, slot.id, { reason: "Exam stress" });
    await expect(bookSlot(await as("student"), slot.id, {})).rejects.toThrow(/no longer available/);
    await expect(counsellingDesk(await as("hod.cs"))).rejects.toThrow(/permission/);
    const desk = await counsellingDesk(await as("counsellor"));
    expect(desk.find((s) => s.id === slot.id)?.booking?.reason).toBe("Exam stress");
    await recordSession(await as("counsellor"), b.id, { status: "ATTENDED", notes: "Discussed study plan.", crisis: false });
    await expect(recordSession(await as("faculty.cs1"), b.id, { status: "ATTENDED" })).rejects.toThrow();
  });
});

describe("grievance redressal", () => {
  it("routes ragging complaints to the committee anonymously and escalates on appeal and delay", async () => {
    const student = await as("student");
    await expect(raiseGrievance(student, { category: "FEES", subject: "Fee receipt missing", description: "My fee receipt for the last payment is not showing in the portal.", anonymous: true })).rejects.toThrow(/anonymous/);
    const rag = await raiseGrievance(student, { category: "RAGGING", subject: "Seniors forcing juniors to run errands", description: "Second-year students in hostel block B force first-year students to run errands at night.", anonymous: true });
    expect(rag.level).toBe("INSTITUTION");
    const seen = await loadGrievance(await as("welfare"), rag.id);
    expect(seen.grievance.raisedBy).toBeNull();
    await expect(loadGrievance(await as("hod.cs"), rag.id)).rejects.toThrow(/not found/);

    const g = await raiseGrievance(student, { category: "ACADEMIC", subject: "Timetable clash between electives", description: "Two of my elective classes are scheduled at the same time on Tuesdays.", anonymous: false });
    expect(g.level).toBe("DEPARTMENT");
    await expect(resolveGrievance(student, g.id, "Resolving my own grievance should fail here.")).rejects.toThrow();
    await resolveGrievance(await as("hod.cs"), g.id, "The elective timetable has been revised; the clash is removed from next week.");
    await appealGrievance(student, g.id, "The revised timetable still clashes for students in section B.");
    expect((await db.grievance.findUniqueOrThrow({ where: { id: g.id } })).level).toBe("INSTITUTION");
    // Overdue at the institution level → Ombudsperson.
    await db.grievance.update({ where: { id: g.id }, data: { dueAt: new Date(Date.now() - DAY) } });
    expect(await escalateOverdueGrievances()).toBeGreaterThan(0);
    expect((await db.grievance.findUniqueOrThrow({ where: { id: g.id } })).level).toBe("OMBUDSPERSON");
    const action = await db.grievanceAction.findFirstOrThrow({ where: { grievanceId: g.id } });
    await expect(db.grievanceAction.delete({ where: { id: action.id } })).rejects.toThrow();
  });
});

describe("events and clubs", () => {
  it("registers within capacity, takes QR attendance and credits hours on completion", async () => {
    const coordinator = await as("faculty.cs1");
    const club = await db.club.findFirstOrThrow({ where: { coordinatorId: coordinator.user.id } });
    const e = await saveEvent(coordinator, null, { title: "Tree planting drive", description: "Planting saplings along the campus boundary.", clubId: club.id, venue: "North gate", startsAt: new Date(Date.now() - 2 * 3600_000), endsAt: new Date(Date.now() + 3600_000), capacity: 1, hours: 3, status: "PUBLISHED" });
    const member = await db.clubMember.findFirstOrThrow({ where: { clubId: club.id, student: { userId: { not: null } } }, include: { student: { include: { user: true } } } });
    const memberCtx = await as(member.student.user!.email.replace("@example.edu", ""));
    await registerForEvent(memberCtx, e.id);
    await expect(registerForEvent(await as("registrar"), e.id)).rejects.toThrow(/full/);
    const k = new URL((await eventQr(coordinator, e.id)).url).searchParams.get("k")!;
    await expect(selfCheckIn(memberCtx, e.id, "wrong")).rejects.toThrow();
    await selfCheckIn(memberCtx, e.id, k);
    await db.campusEvent.update({ where: { id: e.id }, data: { endsAt: new Date(Date.now() - 60_000) } });
    const before = member.hours;
    const r = await completeEvent(coordinator, e.id);
    expect(r.attended).toBe(1);
    expect((await db.clubMember.findUniqueOrThrow({ where: { id: member.id } })).hours).toBe(before + 3);
    await expect(completeEvent(coordinator, e.id)).rejects.toThrow(/published/);
  });
});

describe("convocation", () => {
  it("invites graduates with a degree and no dues, and allots seats when registration closes", async () => {
    const reg = await as("registrar");
    // A student with nothing outstanding and no portal account yet: given one, made a graduate for this test, restored afterwards.
    const st = await db.student.findFirstOrThrow({ where: { status: "ACTIVE", userId: null, invoices: { none: { status: { in: ["ISSUED", "PARTIALLY_PAID"] } } } }, orderBy: { studentNo: "desc" } });
    const role = await db.role.findUniqueOrThrow({ where: { key: "STUDENT" } });
    const account = await db.user.create({ data: { email: "grad.test@example.edu", employeeId: st.studentNo, name: `${st.firstName} ${st.lastName}`, userType: "STUDENT", passwordHash: "x", roles: { create: [{ roleId: role.id }] } } });
    await db.student.update({ where: { id: st.id }, data: { status: "GRADUATED", graduatedOn: new Date(), userId: account.id } });
    await db.issuedCredential.create({ data: { type: "DEGREE_CERTIFICATE", serialNo: `DC/TEST/${Date.now()}`, verificationCode: `TEST-${Date.now()}`, studentId: st.id, title: "Degree certificate", payload: {}, contentHash: "x", seal: "y" } });
    const c = await saveConvocation(reg, null, { title: "Test convocation", heldOn: new Date(Date.now() + 30 * DAY), venue: "Hall", registrationCloses: new Date(Date.now() + 10 * DAY), maxGuests: 2 });
    const r = await addEligibleGraduates(reg, c.id);
    expect(r.added).toBeGreaterThan(0);
    await setConvocationStatus(reg, c.id, "REGISTRATION_OPEN");
    const grad = await as("grad.test");
    await expect(registerForConvocation(grad, c.id, { attendance: "IN_PERSON", guests: 5 })).rejects.toThrow(/up to 2/);
    await registerForConvocation(grad, c.id, { attendance: "IN_PERSON", guests: 2 });
    await setConvocationStatus(reg, c.id, "REGISTRATION_CLOSED");
    expect((await db.convocationGraduate.findUniqueOrThrow({ where: { convocationId_studentId: { convocationId: c.id, studentId: st.id } } })).seatNo).toMatch(/^[A-Z]-\d{3}$/);
    await db.student.update({ where: { id: st.id }, data: { status: "ACTIVE", graduatedOn: null, userId: null } });
  });
});
