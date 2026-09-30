/**
 * Campus-services demo data: library catalogue with copies and loans, hostels with allocations, transport
 * routes with passes, helpdesk tickets, announcements, an open admission cycle with applications, and
 * placement drives with applications and selections.
 */
import { createHash, randomBytes } from "node:crypto";
import type { SeedContext } from "./seed-erp";

export async function seedCampus(s: SeedContext, r: () => number) {
  const { db } = s;
  console.log("› campus services: library, hostels, transport, helpdesk, announcements, admissions, placements");
  const now = s.now.getTime();
  const day = 86_400_000;
  const d = (x: string) => new Date(`${x}T00:00:00Z`);

  // Fee heads for residential services (hostel and transport fees are invoiced).
  const fee = async (code: string, name: string, category: "HOSTEL" | "TRANSPORT") => db.feeHead.create({ data: { code, name, category } });
  await fee("HOSTEL", "Hostel fee", "HOSTEL");
  await fee("TRANSPORT", "Transport fee", "TRANSPORT");

  // ── Library ──
  const books: [string, string, string, number, string, string][] = [
    ["Introduction to Algorithms", "T. H. Cormen, C. E. Leiserson, R. L. Rivest, C. Stein", "9780262046305", 2022, "Algorithms", "005.1 COR"],
    ["Data Structures and Algorithms in Java", "M. T. Goodrich, R. Tamassia", "9781118771334", 2014, "Data structures", "005.73 GOO"],
    ["Database System Concepts", "A. Silberschatz, H. F. Korth, S. Sudarshan", "9789390727506", 2021, "Databases", "005.74 SIL"],
    ["Operating System Concepts", "A. Silberschatz, P. B. Galvin, G. Gagne", "9781119800361", 2021, "Operating systems", "005.43 SIL"],
    ["Computer Networks", "A. S. Tanenbaum, D. J. Wetherall", "9789332518742", 2013, "Networks", "004.6 TAN"],
    ["Clean Code", "R. C. Martin", "9780132350884", 2008, "Software engineering", "005.1 MAR"],
    ["Head First Java", "K. Sierra, B. Bates", "9781491910771", 2022, "Programming", "005.133 SIE"],
    ["The C Programming Language", "B. W. Kernighan, D. M. Ritchie", "9780131103627", 1988, "Programming", "005.133 KER"],
    ["Discrete Mathematics and Its Applications", "K. H. Rosen", "9781260091991", 2018, "Mathematics", "511 ROS"],
    ["Artificial Intelligence: A Modern Approach", "S. Russell, P. Norvig", "9780134610993", 2020, "Artificial intelligence", "006.3 RUS"],
    ["Financial Accounting", "S. N. Maheshwari", "9789390385034", 2021, "Accounting", "657 MAH"],
    ["Corporate Accounting", "T. S. Grewal", "9789352838304", 2020, "Accounting", "657.95 GRE"],
    ["Business Statistics", "S. P. Gupta, M. P. Gupta", "9789351611394", 2019, "Statistics", "519.5 GUP"],
    ["Principles of Marketing", "P. Kotler, G. Armstrong", "9789353940609", 2020, "Marketing", "658.8 KOT"],
    ["Business Law", "N. D. Kapoor", "9789351610915", 2019, "Law", "346.07 KAP"],
  ];
  let acc = 0;
  const copies: { id: string; accessionNo: string }[] = [];
  for (const [title, authors, isbn, year, subject, callNo] of books) {
    const item = await db.libraryItem.create({ data: { title, authors, isbn, year, subject, callNo, publisher: null } });
    const n = 2 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      acc++;
      const c = await db.libraryCopy.create({ data: { itemId: item.id, accessionNo: `ACC${String(acc).padStart(6, "0")}`, location: `Stack ${callNo.slice(0, 3)}` } });
      copies.push(c);
    }
  }
  await db.numberSequence.create({ data: { key: "library.accession", prefix: "ACC", next: acc + 1, padding: 6 } });
  const students = await db.student.findMany({ where: { status: "ACTIVE" }, orderBy: { studentNo: "asc" }, select: { id: true, studentNo: true, gender: true, userId: true, batch: { select: { code: true } } } });
  const demo = students.find((x) => x.userId && x.studentNo === "25BCA0001") ?? students[0];
  const librarian = s.users.librarian.id;
  // Loans: a few current, one overdue (not the demo student), and returned history with a fine.
  const loan = async (copyIdx: number, studentId: string, issuedDaysAgo: number, dueInDays: number, returned?: { daysAgo: number; fine: number }) => {
    const c = copies[copyIdx];
    await db.libraryLoan.create({ data: { copyId: c.id, studentId, issuedAt: new Date(now - issuedDaysAgo * day), dueAt: new Date(now + dueInDays * day), issuedById: librarian, returnedAt: returned ? new Date(now - returned.daysAgo * day) : null, returnedToId: returned ? librarian : null, fineAmount: (returned?.fine ?? 0).toFixed(2) } });
    if (!returned) await db.libraryCopy.update({ where: { id: c.id }, data: { status: "ON_LOAN" } });
  };
  await loan(0, demo.id, 5, 9);
  await loan(4, demo.id, 20, -8, { daysAgo: 8, fine: 0 });
  await loan(7, students[3].id, 25, -11);
  await loan(10, students[5].id, 3, 11);
  await loan(12, students[8].id, 30, -20, { daysAgo: 12, fine: 16 });

  // ── Hostels ──
  const [main] = await db.campus.findMany({ where: { isMain: true } });
  const girls = await db.hostel.create({ data: { code: "GH1", name: "Saraswati Girls' Hostel", campusId: main?.id ?? null, gender: "FEMALE", wardenId: s.users.warden.id, feePerTerm: "32000.00" } });
  const boys = await db.hostel.create({ data: { code: "BH1", name: "Vivekananda Boys' Hostel", campusId: main?.id ?? null, gender: "MALE", wardenId: s.users.warden.id, feePerTerm: "30000.00" } });
  const rooms: Record<string, string[]> = { [girls.id]: [], [boys.id]: [] };
  for (const h of [girls, boys]) for (const n of ["101", "102", "103", "104", "105", "201", "202", "203", "204", "205"]) rooms[h.id].push((await db.hostelRoom.create({ data: { hostelId: h.id, number: n, floor: Number(n[0]), capacity: 3 } })).id);
  let gi = 0;
  let bi = 0;
  for (const st of students.slice(0, 40).filter(() => r() < 0.35)) {
    const female = st.gender === "FEMALE";
    const list = rooms[female ? girls.id : boys.id];
    const idx = female ? gi++ : bi++;
    if (idx >= list.length * 3 - 2) continue;
    await db.hostelAllocation.create({ data: { roomId: list[Math.floor(idx / 3)], studentId: st.id, fromDate: d("2026-07-01"), allocatedById: s.users.warden.id } });
  }

  // ── Transport ──
  const route = async (code: string, name: string, capacity: number, feePerTerm: number, stops: [string, string][]) =>
    db.transportRoute.create({ data: { code, name, vehicle: `KL-07-${code}-${1000 + Math.floor(r() * 8999)}`, driver: null, capacity, feePerTerm: feePerTerm.toFixed(2), stops: stops.map(([n, t]) => ({ name: n, time: t })) } });
  const routes = [
    await route("R1", "North city loop", 45, 9000, [["Railway Station", "07:10"], ["Market Junction", "07:25"], ["Civil Lines", "07:40"], ["Campus Main Gate", "08:05"]]),
    await route("R2", "Harbour road", 40, 10000, [["Harbour Bus Stand", "07:00"], ["Fort Road", "07:20"], ["Lake View", "07:35"], ["Campus Main Gate", "08:05"]]),
    await route("R3", "Hill side", 30, 11000, [["Hill Top", "06:50"], ["Tea Estate", "07:15"], ["Valley Junction", "07:40"], ["Campus Main Gate", "08:10"]]),
  ];
  for (const [i, st] of students.slice(40, 70).entries()) {
    if (r() > 0.45) continue;
    const rt = routes[i % 3];
    const stops = rt.stops as { name: string }[];
    await db.transportPass.create({ data: { routeId: rt.id, studentId: st.id, stop: stops[Math.floor(r() * (stops.length - 1))].name, validFrom: d("2026-07-01"), validTo: d("2026-11-30"), issuedById: s.users.transport.id } });
  }

  // ── Helpdesk ──
  let tk = 0;
  const ticket = async (requesterId: string, category: string, subject: string, body: string, status: "OPEN" | "IN_PROGRESS" | "WAITING" | "RESOLVED" | "CLOSED", hoursAgo: number, sla: number, reply?: string) => {
    tk++;
    const created = new Date(now - hoursAgo * 3_600_000);
    const t = await db.ticket.create({
      data: {
        number: `TKT-26-${String(tk).padStart(5, "0")}`, requesterId, category, subject, status, createdAt: created, dueAt: new Date(created.getTime() + sla * 3_600_000),
        assigneeId: status === "OPEN" ? null : s.users.helpdesk.id, firstResponseAt: reply ? new Date(created.getTime() + 2 * 3_600_000) : null,
        resolvedAt: status === "RESOLVED" || status === "CLOSED" ? new Date(created.getTime() + 10 * 3_600_000) : null, closedAt: status === "CLOSED" ? new Date(created.getTime() + 30 * 3_600_000) : null, satisfaction: status === "CLOSED" ? 5 : null,
        messages: { create: [{ authorId: requesterId, body, createdAt: created }, ...(reply ? [{ authorId: s.users.helpdesk.id, body: reply, createdAt: new Date(created.getTime() + 2 * 3_600_000) }] : [])] },
      },
    });
    return t;
  };
  if (demo.userId) {
    await ticket(demo.userId, "it", "Cannot connect to campus Wi-Fi", "My laptop connects but gets no internet on the campus Wi-Fi since yesterday.", "IN_PROGRESS", 20, 24, "Please share your device's MAC address; we will check the registration.");
    await ticket(demo.userId, "fees", "Receipt not showing for UPI payment", "I paid the semester fee by UPI at the counter but the receipt is not in the portal.", "CLOSED", 200, 48, "The payment was recorded against the wrong invoice and has been corrected.");
  }
  await ticket(s.users["faculty.cs1"].id, "facilities", "Projector not working in AB-201", "The projector in AB-201 turns off after five minutes.", "OPEN", 30, 96);
  await ticket(s.users["faculty.cs2"].id, "it", "Need a Linux lab image update", "Please install Docker in the OS lab image before next week.", "WAITING", 50, 24, "Which version do you need? Docker CE 27 is available.");
  await db.numberSequence.create({ data: { key: "helpdesk.ticket", prefix: "TKT-{YY}-", next: tk + 1, padding: 5 } });

  // ── Announcements ──
  const ann = (title: string, body: string, audience: "EVERYONE" | "STAFF" | "STUDENTS" | "GUARDIANS", daysAgo: number, pinned = false) =>
    db.announcement.create({ data: { title, body, audience, pinned, publishAt: new Date(now - daysAgo * day), notified: true, authorId: s.users.registrar.id } });
  await ann("Mid-semester examinations from 12 October", "The mid-semester (CAT II) examinations begin on 12 October. Timetables are on the class pages.", "STUDENTS", 3, true);
  await ann("Campus closed on 2 October", "The campus will remain closed on 2 October (Gandhi Jayanti).", "EVERYONE", 6);
  await ann("Faculty development programme on outcome-based education", "A two-day FDP on OBE and accreditation will be held on 20–21 October. Register with IQAC.", "STAFF", 2);
  await ann("Parent–teacher meeting", "The parent–teacher meeting for all UG programmes is on Saturday, 17 October, 10:00–13:00.", "GUARDIANS", 1);

  // ── Admissions ──
  const year = await db.academicYear.findFirstOrThrow({ where: { isCurrent: true } });
  const cycle = await db.admissionCycle.create({ data: { name: "Spot / lateral admissions 2026", academicYearId: year.id, opensAt: new Date(now - 10 * day), closesAt: new Date(now + 20 * day), isPublic: true } });
  const [bca26, bcom26] = await Promise.all([db.batch.findFirst({ where: { code: "BCA-2026" } }), db.batch.findFirst({ where: { code: { startsWith: "BCOM-2026" } } })]);
  if (bca26) await db.admissionSeat.create({ data: { cycleId: cycle.id, programId: bca26.programId, batchId: bca26.id, seats: 4, offerValidDays: 7 } });
  if (bcom26) await db.admissionSeat.create({ data: { cycleId: cycle.id, programId: bcom26.programId, batchId: bcom26.id, seats: 3, offerValidDays: 7 } });
  const names = [["Aditi", "Rao"], ["Karthik", "Menon"], ["Sneha", "Iyer"], ["Rahul", "Nair"], ["Fathima", "Beevi"], ["Arjun", "Pillai"], ["Divya", "Thomas"], ["Nikhil", "Das"], ["Pooja", "Shetty"]];
  let ap = 0;
  for (const [i, [first, last]] of names.entries()) {
    if (!bca26) break;
    ap++;
    const status = i < 1 ? "OFFERED" : i < 5 ? "VERIFIED" : i < 8 ? "SUBMITTED" : "REJECTED";
    const q = 60 + Math.round(r() * 35);
    const e = status === "SUBMITTED" ? null : 50 + Math.round(r() * 45);
    await db.admissionApplication.create({
      data: {
        number: `APP26-${String(ap).padStart(6, "0")}`, cycleId: cycle.id, programId: bca26.programId, firstName: first, lastName: last, email: `${first}.${last}${i}@applicant.example.com`.toLowerCase(), phone: `+91 94470 ${String(10000 + i * 137).slice(0, 5)}`,
        dateOfBirth: d(`2008-0${1 + (i % 9)}-1${i % 9}`), gender: i % 2 ? "MALE" : "FEMALE", category: i % 3 ? "General" : "OBC", qualifyingExam: "Kerala Higher Secondary (Class XII)", qualifyingPercent: q, entranceScore: e,
        meritScore: e === null ? null : Math.round((q * 60 + e * 40) / 100 * 100) / 100, status, remarks: status === "REJECTED" ? "Qualifying subject requirement (Mathematics) not met" : null,
        offerExpiresAt: status === "OFFERED" ? new Date(now + 5 * day) : null, accessTokenHash: createHash("sha256").update(randomBytes(24).toString("base64url")).digest("hex"), createdAt: new Date(now - (9 - i) * day),
      },
    });
  }
  await db.numberSequence.create({ data: { key: "admission.application", prefix: "APP{YY}-", next: ap + 1, padding: 6 } });

  // ── Placements ──
  const company = (name: string, industry: string, website: string) => db.company.create({ data: { name, industry, website } });
  const infy = await company("Infosys", "IT services", "https://www.infosys.com");
  const tcs = await company("Tata Consultancy Services", "IT services", "https://www.tcs.com");
  const ibm = await company("IBM India", "Technology", "https://www.ibm.com/in-en");
  await company("Federal Bank", "Banking", "https://www.federalbank.co.in");
  const finalYear = await db.batch.findFirst({ where: { code: "BCA-2024" } });
  const drive = (companyId: string, title: string, role: string, ctc: number, status: "OPEN" | "COMPLETED" | "DRAFT", applyInDays: number, minCgpa: number) =>
    db.placementDrive.create({ data: { companyId, title, role, description: `${role} role. Selection: online test, technical interview and HR interview.`, location: "Bengaluru / Kochi", ctc: ctc.toFixed(2), eligibility: { minCgpa, programCodes: ["BCA"], maxActiveBacklogs: 0, batchYears: finalYear ? [finalYear.admissionYear] : [] }, applyBy: new Date(now + applyInDays * day), status, createdById: s.users.placement.id } });
  const done = await drive(tcs.id, "TCS Ninja hiring 2026", "Assistant System Engineer", 360000, "COMPLETED", -30, 6);
  await drive(infy.id, "Infosys Systems Engineer 2026", "Systems Engineer", 400000, "OPEN", 14, 6.5);
  await drive(ibm.id, "IBM Associate Developer", "Associate Developer", 520000, "DRAFT", 30, 7.5);
  const fy = finalYear ? await db.student.findMany({ where: { batchId: finalYear.id }, orderBy: { studentNo: "asc" }, take: 12 }) : [];
  for (const [i, st] of fy.entries()) {
    const status = i < 3 ? "SELECTED" : i < 6 ? "REJECTED" : "APPLIED";
    await db.placementApplication.create({ data: { driveId: done.id, studentId: st.id, status: status === "APPLIED" ? "REJECTED" : status, offerCtc: status === "SELECTED" ? "360000.00" : null, snapshot: { note: "seeded" }, updatedById: s.users.placement.id } });
  }
}
