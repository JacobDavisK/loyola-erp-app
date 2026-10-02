/**
 * Operations demo data: vendors, stores and stock; a completed purchase (request → order → receipt → bill,
 * posted to the ledger) and an issue to a department; department budgets; a fixed-asset register; room
 * bookings; visitors at the gate; hostel out-passes; and health-centre visits.
 */
import type { SeedContext } from "./seed-erp";

const ACCOUNTS = [
  ["1110", "Bank", "ASSET"], ["1300", "Stores inventory", "ASSET"], ["1500", "Fixed assets (at cost)", "ASSET"], ["1590", "Accumulated depreciation", "ASSET"],
  ["2400", "Vendors payable", "LIABILITY"], ["5300", "Services and purchases", "EXPENSE"], ["5310", "Stores consumed", "EXPENSE"], ["5400", "Depreciation", "EXPENSE"], ["5410", "Loss / (gain) on disposal of assets", "EXPENSE"],
] as const;

export async function seedOperations(s: SeedContext) {
  const { db } = s;
  console.log("› operations: purchasing, stores, budgets, assets, rooms, gate, health centre");
  const day = 86_400_000;
  const now = s.now.getTime();
  const at = (days: number, hourUtc: number, min = 0) => { const d = new Date(now + days * day); d.setUTCHours(hourUtc, min, 0, 0); return d; };
  const money = (n: number) => n.toFixed(2);
  const u = s.users;

  const acct: Record<string, string> = Object.fromEntries((await db.ledgerAccount.findMany()).map((a) => [a.code, a.id]));
  for (const [code, name, type] of ACCOUNTS) if (!acct[code]) acct[code] = (await db.ledgerAccount.create({ data: { code, name, type } })).id;
  const seq = await db.numberSequence.findUnique({ where: { key: "journal" } });
  let jv = seq?.next ?? 1;
  const journal = async (date: Date, memo: string, sourceType: string, sourceId: string, lines: { code: string; debit?: number; credit?: number; dept?: string }[]) => {
    await db.journalEntry.create({ data: { number: `JV/${date.getUTCFullYear()}/${String(jv++).padStart(6, "0")}`, date, memo, sourceType, sourceId, postedById: u.accounts.id, lines: { create: lines.map((l) => ({ accountId: acct[l.code], debit: money(l.debit ?? 0), credit: money(l.credit ?? 0), departmentId: l.dept ?? null })) } } });
  };

  // Vendors, stores, items.
  const v = async (name: string, gstin: string, contactName: string, phone: string, categories: string[]) => db.vendor.create({ data: { name, gstin, contactName, phone, email: `sales@${name.split(" ")[0].toLowerCase()}.example.in`, address: "Chennai, Tamil Nadu", categories } });
  const vStationery = await v("Saraswathi Stationers", "33AABCS1234F1Z5", "K. Murugan", "+91 94440 12345", ["Stationery", "Printing"]);
  await v("Chennai Computer Systems", "33AACCC5678G1Z2", "Rahul Iyer", "+91 98400 23456", ["IT", "Computers", "AV equipment"]);
  await v("Sri Lakshmi Scientific", "33AAFCS9012H1Z8", "Dr. P. Lakshmi", "+91 99620 34567", ["Lab consumables", "Chemicals"]);
  await v("Royal Furniture Works", "33AAGFR3456J1Z1", "Abdul Rahim", "+91 90030 45678", ["Furniture"]);
  const central = await db.store.create({ data: { name: "Central Store", location: "Administrative Block, ground floor", keeperId: u.stores.id } });
  const science = await db.store.create({ data: { name: "Science Store", location: "Science Block, room S-04", keeperId: u.stores.id } });
  const item = (code: string, name: string, unit: string, category: string, reorderLevel: number) => db.stockItem.create({ data: { code, name, unit, category, reorderLevel } });
  const paper = await item("ST-A4", "A4 paper, 75 gsm", "ream", "Stationery", 40);
  const marker = await item("ST-WBM", "Whiteboard marker", "nos", "Stationery", 100);
  const toner = await item("IT-TNR", "Laser printer toner 88A", "nos", "IT consumables", 6);
  const answer = await item("EX-ANS", "Answer booklet, 32 pages", "nos", "Examination", 2000);
  const ethanol = await item("LB-ETH", "Ethanol 99.9%, 500 ml", "bottle", "Lab consumables", 10);
  const gloves = await item("LB-GLV", "Nitrile gloves (box of 100)", "box", "Lab consumables", 20);

  // Budgets for this financial year: CS approved, Commerce in draft.
  const fyStart = new Date(s.now.getUTCMonth() >= 3 ? Date.UTC(s.now.getUTCFullYear(), 3, 1) : Date.UTC(s.now.getUTCFullYear() - 1, 3, 1));
  const fy = `${fyStart.getUTCFullYear()}-${String((fyStart.getUTCFullYear() + 1) % 100).padStart(2, "0")}`;
  const csBudget = await db.budget.create({ data: { fiscalYear: fy, departmentId: s.dept.CS, status: "APPROVED", notes: "Includes the networks lab upgrade.", createdById: u.accounts.id, approvedById: u.finance.id, approvedAt: new Date(fyStart.getTime() + 10 * day) } });
  const csConsumables = await db.budgetLine.create({ data: { budgetId: csBudget.id, accountId: acct["5310"], amount: money(150000), note: "Stationery, toner, lab consumables" } });
  const csAssets = await db.budgetLine.create({ data: { budgetId: csBudget.id, accountId: acct["1500"], amount: money(1800000), note: "Networks lab: 30 desktops, switch, projector" } });
  await db.budgetLine.create({ data: { budgetId: csBudget.id, accountId: acct["1300"], amount: money(120000), note: "Stores purchased for the department" } });
  await db.budgetLine.create({ data: { budgetId: csBudget.id, accountId: acct["5300"], amount: money(200000), note: "AMC and repairs" } });
  const comBudget = await db.budget.create({ data: { fiscalYear: fy, departmentId: s.dept.COM, notes: "Draft for the finance committee.", createdById: u.accounts.id } });
  await db.budgetLine.create({ data: { budgetId: comBudget.id, accountId: acct["5310"], amount: money(80000) } });
  await db.budgetLine.create({ data: { budgetId: comBudget.id, accountId: acct["1500"], amount: money(400000), note: "Smart classroom" } });

  // A completed purchase: stationery for CS, received into the central store and billed.
  const ordered = at(-40, 5);
  const pr1 = await db.purchaseRequest.create({
    data: {
      number: "PR/2026/00001", departmentId: s.dept.CS, requestedById: u["hod.cs"].id, title: "Stationery for the semester", justification: "Paper and markers for classes, internal assessments and department office for the odd semester.", budgetLineId: csConsumables.id, status: "ORDERED", total: money(33000), createdAt: new Date(ordered.getTime() - 5 * day),
      lines: { create: [{ kind: "STOCK", description: paper.name, itemId: paper.id, quantity: 100, unit: "ream", estUnitPrice: money(280) }, { kind: "STOCK", description: marker.name, itemId: marker.id, quantity: 200, unit: "nos", estUnitPrice: money(25) }] },
    },
  });
  const po1 = await db.purchaseOrder.create({
    data: {
      number: "PO/2026/00001", requestId: pr1.id, vendorId: vStationery.id, departmentId: s.dept.CS, status: "RECEIVED", orderDate: ordered, taxPercent: 12, total: money((100 * 270 + 200 * 24) * 1.12), terms: "Delivery to the central store within 7 days.", createdById: u.purchase.id,
      lines: { create: [{ kind: "STOCK", description: paper.name, itemId: paper.id, quantity: 100, unit: "ream", unitPrice: money(270), receivedQty: 100 }, { kind: "STOCK", description: marker.name, itemId: marker.id, quantity: 200, unit: "nos", unitPrice: money(24), receivedQty: 200 }] },
    },
    include: { lines: true },
  });
  const grn = await db.goodsReceipt.create({ data: { number: "GRN/2026/00001", poId: po1.id, storeId: central.id, receivedById: u.stores.id, receivedAt: at(-34, 6), notes: "Counted and checked; all in good condition.", lines: { create: po1.lines.map((l) => ({ poLineId: l.id, quantity: l.quantity })) } } });
  await db.stockMovement.createMany({ data: [
    { itemId: paper.id, storeId: central.id, kind: "RECEIPT", quantity: 100, unitCost: (270 * 1.12).toFixed(4), refType: "goodsReceipt", refId: grn.id, createdById: u.stores.id, createdAt: at(-34, 6) },
    { itemId: marker.id, storeId: central.id, kind: "RECEIPT", quantity: 200, unitCost: (24 * 1.12).toFixed(4), refType: "goodsReceipt", refId: grn.id, createdById: u.stores.id, createdAt: at(-34, 6) },
  ] });
  const billAmount = (100 * 270 + 200 * 24) * 1.12;
  const bill = await db.vendorInvoice.create({ data: { poId: po1.id, vendorId: vStationery.id, invoiceNo: "SS/2026/0412", invoiceDate: at(-33, 0), amount: money(billAmount), status: "PAID", approvedById: u.accounts.id, approvedAt: at(-30, 6), paidAt: at(-25, 6), paymentRef: "NEFT UTIBH26145578" } });
  await journal(at(-30, 6), `Vendor bill ${bill.invoiceNo} on ${po1.number}`, "vendorInvoice", bill.id, [{ code: "1300", debit: billAmount, dept: s.dept.CS }, { code: "2400", credit: billAmount }]);
  await journal(at(-25, 6), `Payment of vendor bill ${bill.invoiceNo} (NEFT UTIBH26145578)`, "vendorPayment", bill.id, [{ code: "2400", debit: billAmount }, { code: "1110", credit: billAmount }]);
  // Issues from the store to departments.
  const issue = async (it: { id: string; name: string }, qty: number, unitCost: number, dept: string, daysAgo: number, note: string) => {
    const m = await db.stockMovement.create({ data: { itemId: it.id, storeId: central.id, kind: "ISSUE", quantity: -qty, unitCost: unitCost.toFixed(4), departmentId: dept, note, createdById: u.stores.id, createdAt: at(-daysAgo, 5) } });
    await journal(at(-daysAgo, 5), `Stores issue: ${qty} ${it.name}`, "stockIssue", m.id, [{ code: "5310", debit: Math.round(qty * unitCost * 100) / 100, dept }, { code: "1300", credit: Math.round(qty * unitCost * 100) / 100 }]);
  };
  await issue(paper, 40, 270 * 1.12, s.dept.CS, 28, "Indent CS/14 — internal assessments");
  await issue(marker, 120, 24 * 1.12, s.dept.CS, 27, "Indent CS/15");
  await issue(paper, 25, 270 * 1.12, s.dept.COM, 20, "Indent COM/08");
  // Opening stock elsewhere (no purchase on record).
  await db.stockMovement.createMany({ data: [
    { itemId: toner.id, storeId: central.id, kind: "ADJUSTMENT", quantity: 4, unitCost: "3200.0000", note: "Opening balance", createdById: u.stores.id, createdAt: at(-60, 5) },
    { itemId: answer.id, storeId: central.id, kind: "ADJUSTMENT", quantity: 6500, unitCost: "9.5000", note: "Opening balance", createdById: u.stores.id, createdAt: at(-60, 5) },
    { itemId: ethanol.id, storeId: science.id, kind: "ADJUSTMENT", quantity: 18, unitCost: "640.0000", note: "Opening balance", createdById: u.stores.id, createdAt: at(-60, 5) },
    { itemId: gloves.id, storeId: science.id, kind: "ADJUSTMENT", quantity: 12, unitCost: "450.0000", note: "Opening balance", createdById: u.stores.id, createdAt: at(-60, 5) },
  ] });

  // Requests in other states: an approved projector (ready to order) and a draft lab upgrade.
  await db.purchaseRequest.create({
    data: {
      number: "PR/2026/00002", departmentId: s.dept.CS, requestedById: u["hod.cs"].id, title: "Projector for the seminar room", justification: "The existing projector in the CS seminar room has failed twice this term and is beyond economical repair.", budgetLineId: csAssets.id, status: "APPROVED", total: money(68000), createdAt: at(-6, 5),
      lines: { create: [{ kind: "ASSET", description: "Laser projector, 4000 lumens, with ceiling mount", quantity: 1, unit: "nos", estUnitPrice: money(68000) }] },
    },
  });
  await db.purchaseRequest.create({
    data: {
      number: "PR/2026/00003", departmentId: s.dept.CS, requestedById: u["hod.cs"].id, title: "30 desktop computers for the networks lab", justification: "Replacement of 2017 machines that cannot run the current network simulation software (GNS3, Wireshark). Three quotations attached.", budgetLineId: csAssets.id, status: "DRAFT", total: money(30 * 52000), createdAt: at(-1, 5),
      lines: { create: [{ kind: "ASSET", description: "Desktop: Core i5, 16 GB RAM, 512 GB SSD, 24\" monitor", quantity: 30, unit: "nos", estUnitPrice: money(52000) }] },
    },
  });
  await db.numberSequence.createMany({ data: [
    { key: "procurement.pr", prefix: "PR/{YYYY}/", next: 4, padding: 5 },
    { key: "procurement.po", prefix: "PO/{YYYY}/", next: 2, padding: 5 },
    { key: "procurement.grn", prefix: "GRN/{YYYY}/", next: 2, padding: 5 },
  ] });

  // Fixed assets.
  const assets: [string, string, string, string, number, number, "STRAIGHT_LINE" | "WRITTEN_DOWN_VALUE", number | null, string][] = [
    ["Desktop computer (Computing lab 1), set of 40", "Computers & IT", "CS", "2023-07-15", 1_880_000, 4, "STRAIGHT_LINE", null, "SB-L1"],
    ["Network switch, 48-port managed", "Computers & IT", "CS", "2024-01-10", 145_000, 6, "STRAIGHT_LINE", null, "SB-L2"],
    ["Projector (Lecture hall 101)", "AV equipment", "CS", "2022-06-20", 72_000, 5, "STRAIGHT_LINE", null, "AB-101"],
    ["Interactive flat panel 75\"", "AV equipment", "CS", "2025-02-05", 210_000, 7, "STRAIGHT_LINE", null, "AB-301"],
    ["Server, 2U rack (department file server)", "Computers & IT", "CS", "2024-08-01", 395_000, 5, "STRAIGHT_LINE", null, "SB server room"],
    ["Classroom benches, set of 35", "Furniture", "COM", "2021-06-01", 245_000, 10, "STRAIGHT_LINE", null, "CB-11"],
    ["Air conditioner 2 TR (Classroom 12)", "Electrical", "COM", "2023-04-12", 62_000, 8, "STRAIGHT_LINE", null, "CB-12"],
    ["Photocopier, multifunction A3", "Office equipment", "COM", "2024-11-18", 168_000, 5, "STRAIGHT_LINE", null, "Department office"],
    ["Campus bus (Route 2)", "Vehicles", "COM", "2022-03-01", 2_850_000, 15, "WRITTEN_DOWN_VALUE", 15, "Transport yard"],
  ];
  const tagPrefix = `AST/${new Date(now).getUTCFullYear()}/`;
  let n = 1;
  for (const [name, category, d, date, cost, life, method, rate, location] of assets) {
    const a = await db.asset.create({ data: { tag: `${tagPrefix}${String(n++).padStart(5, "0")}`, name, category, departmentId: s.dept[d], location, purchaseDate: new Date(`${date}T00:00:00Z`), cost: money(cost), salvageValue: money(Math.round(cost * 0.05)), usefulLifeYears: life, method, wdvRate: rate, status: name.startsWith("Projector") ? "IN_REPAIR" : "IN_USE" } });
    await db.assetEvent.create({ data: { assetId: a.id, kind: "ACQUIRED", note: "Brought into the register (opening balance)", actorId: u.estate.id, createdAt: new Date(`${date}T06:00:00Z`) } });
    if (name.startsWith("Projector")) await db.assetEvent.create({ data: { assetId: a.id, kind: "REPAIR", note: "Lamp and colour wheel failure; sent to the service centre.", actorId: u.estate.id, createdAt: at(-9, 6) } });
    else await db.assetEvent.create({ data: { assetId: a.id, kind: "VERIFIED", note: "Annual physical verification", actorId: u.estate.id, createdAt: at(-45, 6) } });
  }
  await db.numberSequence.create({ data: { key: "asset.tag", prefix: "AST/{YYYY}/", next: n, padding: 5 } });

  // Room bookings.
  const rooms = Object.fromEntries((await db.room.findMany({ select: { id: true, code: true } })).map((r) => [r.code, r.id]));
  await db.facilityBooking.create({ data: { roomId: rooms["AB-201"], title: "Board of Studies (CS) meeting", bookedById: u["hod.cs"].id, startsAt: at(1, 9), endsAt: at(1, 11), attendees: 12, status: "APPROVED", decidedAt: at(-1, 5), decisionNote: "Confirmed automatically" } });
  await db.facilityBooking.create({ data: { roomId: rooms["AB-301"], title: "Guest lecture: cloud security", purpose: "Projector, two microphones; 100 students from CS and IT.", bookedById: u["faculty.cs2"].id, startsAt: at(3, 8, 30), endsAt: at(3, 10, 30), attendees: 100, status: "REQUESTED" } });
  await db.facilityBooking.create({ data: { roomId: rooms["SB-EH"], title: "Placement aptitude test (TCS)", purpose: "Seating for 140; invigilation by the placement cell.", bookedById: u.placement.id, startsAt: at(5, 4), endsAt: at(5, 7), attendees: 140, status: "REQUESTED" } });

  // Visitors.
  await db.visitor.createMany({ data: [
    { name: "Mr. Senthil Kumar", phone: "+91 98410 11223", purpose: "Parent meeting with the class mentor", hostUserId: u["faculty.cs1"].id, hostName: u["faculty.cs1"].name, checkedInAt: new Date(now - 50 * 60_000), createdById: u.security.id },
    { name: "Ms. Farah Khan (Chennai Computer Systems)", phone: "+91 98400 23456", purpose: "Demo of desktops for the networks lab", hostUserId: u.purchase.id, hostName: u.purchase.name, vehicleNo: "TN09 BK 4421", checkedInAt: new Date(now - 25 * 60_000), createdById: u.security.id },
    { name: "Dr. R. Balaji (external examiner)", phone: "+91 94442 77889", purpose: "Practical examination, B.Sc. CS", hostUserId: u["hod.cs"].id, hostName: u["hod.cs"].name, passCode: "482913", expectedAt: at(1, 3, 30), createdById: u["hod.cs"].id },
    { name: "Courier (Blue Dart)", phone: "+91 90000 12345", purpose: "Delivery to the Examination Office", hostName: "Examination Office", checkedInAt: at(-1, 6), checkedOutAt: at(-1, 6, 20), createdById: u.security.id },
  ] });

  // Out-passes for hostel residents.
  const residents = await db.hostelAllocation.findMany({ where: { vacatedAt: null }, select: { studentId: true }, take: 6, orderBy: { createdAt: "asc" } });
  if (residents.length >= 4) {
    const [a, b, c, d] = residents.map((r) => r.studentId);
    await db.outpass.create({ data: { studentId: a, reason: "Sister's wedding", destination: "Madurai (home)", leaveAt: at(2, 11), returnBy: at(5, 13), status: "REQUESTED" } });
    await db.outpass.create({ data: { studentId: b, reason: "Weekend at home", destination: "Vellore (home)", leaveAt: at(1, 11), returnBy: at(3, 14), status: "APPROVED", decidedById: u.warden.id, decidedAt: at(0, 4), guardianNotified: true } });
    await db.outpass.create({ data: { studentId: c, reason: "Dental appointment", destination: "Apollo Dental, T. Nagar", leaveAt: at(0, 3), returnBy: new Date(now - 30 * 60_000), status: "OUT", decidedById: u.warden.id, decidedAt: at(-1, 10), guardianNotified: true, outAt: at(0, 3, 10) } });
    await db.outpass.create({ data: { studentId: d, reason: "Inter-collegiate cricket match", destination: "Loyola College ground", leaveAt: at(-6, 2), returnBy: at(-6, 14), status: "RETURNED", decidedById: u.warden.id, decidedAt: at(-7, 9), guardianNotified: true, outAt: at(-6, 2, 5), inAt: at(-6, 15, 40), late: true } });
  }

  // Health-centre visits over the last month.
  const students = await db.student.findMany({ where: { status: "ACTIVE" }, select: { id: true }, take: 12, orderBy: { studentNo: "asc" } });
  const complaints: [string, string, string, number, boolean][] = [
    ["Fever and body ache since yesterday", "Viral fever", "Paracetamol 650 mg TDS × 3 days; fluids", 2, true],
    ["Headache", "Tension headache", "Paracetamol 500 mg SOS", 0, false],
    ["Sprained ankle during football", "Grade I ankle sprain", "Crepe bandage, ice, rest; ibuprofen 400 mg BD × 3 days", 3, true],
    ["Stomach pain and loose stools", "Acute gastroenteritis", "ORS, ondansetron 4 mg SOS; bland diet", 1, true],
    ["Cough and cold", "Upper respiratory infection", "Cetirizine 10 mg HS × 5 days; steam inhalation", 0, false],
    ["Fever and sore throat", "Viral fever", "Paracetamol 650 mg TDS × 3 days", 2, true],
    ["Minor cut on the hand in the lab", "Laceration, superficial", "Cleaned and dressed; TT given", 0, false],
    ["Fever", "Viral fever", "Paracetamol 650 mg TDS × 3 days", 1, false],
  ];
  for (const [i, [complaint, diagnosis, treatment, restDays, certificate]] of complaints.entries()) {
    const st = students[i % students.length];
    if (!st) break;
    await db.clinicVisit.create({ data: { studentId: st.id, visitedAt: at(-(i * 3 + 1), 4 + (i % 5)), complaint, vitals: { temperature: diagnosis.includes("fever") || diagnosis.includes("Viral") ? 38.4 : 36.8, pulse: 78 + i, bp: "118/76" }, diagnosis, treatment, prescription: treatment, restDays, certificate, attendedById: u.doctor.id } });
  }
  const emp = await db.employee.findFirst({ where: { userId: u.librarian.id } });
  if (emp) await db.clinicVisit.create({ data: { employeeId: emp.id, visitedAt: at(-4, 6), complaint: "Dizziness", vitals: { bp: "146/94", pulse: 88 }, diagnosis: "Raised blood pressure", treatment: "Rest; advised review with physician", referral: "Government General Hospital, cardiology OPD", attendedById: u.doctor.id } });

  if (seq) await db.numberSequence.update({ where: { key: "journal" }, data: { next: jv } });
  else await db.numberSequence.create({ data: { key: "journal", prefix: "JV/{YYYY}/", next: jv, padding: 6 } });
}
