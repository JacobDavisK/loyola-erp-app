/**
 * HR demo data: employee records for staff accounts (with reporting lines), positions, leave policy and
 * 2026 balances, some approved leave, September staff attendance, salary components and structures,
 * employee pay, and a paid August 2026 payroll with its ledger entries.
 */
import { computePayslip, eachDay, isoDay, type PayComponent, type PayslipResult, type TaxRegime } from "../src/lib/domain/hr";
import { fromMinor, sum, toMinor } from "../src/lib/domain/money";
import type { SeedContext } from "./seed-erp";

const TAX: TaxRegime = {
  standardDeduction: 75000,
  slabs: [{ upTo: 400000, rate: 0 }, { upTo: 800000, rate: 5 }, { upTo: 1200000, rate: 10 }, { upTo: 1600000, rate: 15 }, { upTo: 2000000, rate: 20 }, { upTo: 2400000, rate: 25 }, { upTo: null, rate: 30 }],
  rebateLimit: 1200000, rebateMax: 60000, cessPercent: 4,
};

export async function seedHr(s: SeedContext, r: () => number) {
  const { db } = s;
  console.log("› HR: employees, leave, attendance, payroll");
  const d = (x: string) => new Date(`${x}T00:00:00Z`);

  const pos = async (code: string, title: string, category: "TEACHING" | "NON_TEACHING", dept: string | null, grade: string, sanctioned: number) =>
    (await db.position.create({ data: { code, title, category, departmentId: dept ? s.dept[dept] : null, grade, sanctioned } })).id;
  const P = {
    prof: await pos("PROF-CS", "Professor, Computer Science", "TEACHING", "CS", "AL-14", 2),
    asst: await pos("AP-CS", "Assistant Professor, Computer Science", "TEACHING", "CS", "AL-10", 8),
    apCom: await pos("AP-COM", "Assistant Professor, Commerce", "TEACHING", "COM", "AL-10", 6),
    admin: await pos("ADM-OFF", "Administrative Officer", "NON_TEACHING", null, "L-8", 10),
  };

  // Every internal staff account gets an employee record (external moderators are not employees).
  const external = new Set(["moderator", "moderator2"]);
  const teachingHandles = /^(hod\.|setter|faculty\.|valuer|dean\.|principal\.|approver|controller|deputy|research|iqac)/;
  const users = await db.user.findMany({ where: { userType: "STAFF", deletedAt: null }, orderBy: { employeeId: "asc" } });
  const handleOf = (email: string) => email.split("@")[0];
  const emp: Record<string, { id: string; basic: number; teaching: boolean }> = {};
  let n = 0;
  for (const u of users) {
    const h = handleOf(u.email);
    if (external.has(h) || u.employeeId?.startsWith("EXT")) continue;
    n++;
    const teaching = teachingHandles.test(h);
    const [first, ...rest] = u.name.replace(/^(Dr\.|Prof\.)\s*/, "").split(" ");
    const senior = /Professor & Head|Dean|Principal|Registrar|Controller/.test(u.designation ?? "");
    const basic = senior ? 144200 : /Associate/.test(u.designation ?? "") ? 131400 : teaching ? 57700 : /Officer|Manager|Deputy/.test(u.designation ?? "") ? 56100 : 35400;
    const e = await db.employee.create({
      data: {
        userId: u.id, employeeNo: u.employeeId ?? `EMP26${String(n).padStart(4, "0")}`, firstName: first, lastName: rest.join(" ") || "-", email: u.email, phone: u.phone,
        category: teaching ? "TEACHING" : "NON_TEACHING", employmentType: h === "setter2" ? "PROBATION" : "PERMANENT", departmentId: u.departmentId,
        positionId: h === "hod.cs" ? P.prof : h.startsWith("faculty.cs") || h === "setter2" ? P.asst : h === "faculty.com1" ? P.apCom : !teaching ? P.admin : null,
        designation: u.designation ?? "Staff", joinDate: d(`20${10 + Math.floor(r() * 14)}-0${1 + Math.floor(r() * 8)}-01`),
        qualifications: teaching ? [{ degree: "Ph.D.", institution: "Loyola University", year: 2012 }] : undefined,
      },
    });
    emp[h] = { id: e.id, basic, teaching };
  }
  // Reporting lines
  const reports = async (h: string, to: string) => emp[h] && emp[to] && db.employee.update({ where: { id: emp[h].id }, data: { reportingToId: emp[to].id } });
  for (const h of Object.keys(emp)) {
    if (/^(faculty\.cs|setter2?$|valuer)/.test(h)) await reports(h, "hod.cs");
    else if (/^(faculty\.com|setter[34]$)/.test(h)) await reports(h, "hod.commerce");
    else if (h === "hod.cs") await reports(h, "dean.science");
    else if (h === "hod.commerce") await reports(h, "principal.city");
    else if (["finance", "accounts", "hr", "uniadmin", "itadmin", "examcell", "scrutiny"].includes(h)) await reports(h, "registrar");
  }
  // A recent joiner on probation, to show pro-rated leave and pay.
  if (emp.setter2) await db.employee.update({ where: { id: emp.setter2.id }, data: { joinDate: d("2026-07-01") } });

  // Leave policy
  const lt = async (code: string, name: string, annualQuota: number, carryForwardMax: number, paid = true, extra: object = {}) =>
    db.leaveType.create({ data: { code, name, annualQuota, carryForwardMax, paid, ...extra } });
  const CL = await lt("CL", "Casual leave", 12, 0, true, { maxConsecutive: 3 });
  const EL = await lt("EL", "Earned leave", 30, 300, true, { allowHalfDay: false });
  const SL = await lt("SL", "Sick leave", 10, 60, true, { requiresDocument: true });
  await lt("DL", "Duty leave (academic)", 15, 0, true, { appliesTo: "TEACHING" });
  const LWP = await lt("LWP", "Leave without pay", 0, 0, false);
  const types = [CL, EL, SL];
  for (const [h, e] of Object.entries(emp)) {
    const joined = h === "setter2";
    for (const t of types) {
      await db.leaveBalance.create({ data: { employeeId: e.id, leaveTypeId: t.id, year: 2026, entitled: joined ? t.annualQuota / 2 : t.annualQuota, carriedForward: t.code === "EL" && !joined ? 12 + Math.floor(r() * 30) : 0, used: 0 } });
    }
  }
  // Approved history (balances and attendance marks follow)
  const approved = async (h: string, t: typeof CL, from: string, to: string, days: number, reason: string) => {
    if (!emp[h]) return;
    await db.leaveRequest.create({ data: { employeeId: emp[h].id, leaveTypeId: t.id, fromDate: d(from), toDate: d(to), days, reason, status: "APPROVED", decidedAt: d(from) } });
    if (t.paid) await db.leaveBalance.update({ where: { employeeId_leaveTypeId_year: { employeeId: emp[h].id, leaveTypeId: t.id, year: 2026 } }, data: { used: { increment: days } } });
    for (const x of eachDay(d(from), d(to)).filter((x) => isoDay(x) !== 7)) {
      await db.staffAttendance.upsert({ where: { employeeId_date: { employeeId: emp[h].id, date: x } }, create: { employeeId: emp[h].id, date: x, status: "ON_LEAVE", source: "LEAVE", remarks: t.code }, update: {} });
    }
  };
  await approved("faculty.cs1", CL, "2026-08-13", "2026-08-14", 2, "Family function");
  await approved("faculty.cs2", SL, "2026-09-07", "2026-09-09", 3, "Viral fever; medical certificate submitted");
  await approved("setter", EL, "2026-05-11", "2026-05-22", 11, "Summer vacation travel");
  await approved("faculty.com1", LWP, "2026-08-24", "2026-08-25", 2, "Personal work beyond casual leave");

  // September attendance up to the 25th (Mon–Sat); a few absences.
  const days = eachDay(d("2026-09-01"), d("2026-09-25")).filter((x) => isoDay(x) !== 7);
  const rows: { employeeId: string; date: Date; status: "PRESENT" | "ABSENT" | "HALF_DAY"; markedById: string }[] = [];
  const taken = new Set((await db.staffAttendance.findMany({ select: { employeeId: true, date: true } })).map((a) => `${a.employeeId}:${a.date.toISOString()}`));
  for (const e of Object.values(emp)) {
    for (const x of days) {
      if (taken.has(`${e.id}:${x.toISOString()}`)) continue;
      const y = r();
      rows.push({ employeeId: e.id, date: x, status: y < 0.015 ? "ABSENT" : y < 0.03 ? "HALF_DAY" : "PRESENT", markedById: s.users.hr.id });
    }
  }
  await db.staffAttendance.createMany({ data: rows });

  // Salary components and structures
  const accounts = Object.fromEntries((await db.ledgerAccount.findMany()).map((a) => [a.code, a.id]));
  for (const [code, name, type] of [["2300", "Salaries payable", "LIABILITY"], ["2310", "Statutory deductions payable", "LIABILITY"], ["2320", "Tax deducted at source payable", "LIABILITY"], ["5200", "Salaries and wages", "EXPENSE"], ["5210", "Employer statutory contributions", "EXPENSE"]] as const) {
    if (!accounts[code]) accounts[code] = (await db.ledgerAccount.create({ data: { code, name, type } })).id;
  }
  const comp = (code: string, name: string, kind: "EARNING" | "DEDUCTION" | "EMPLOYER_CONTRIBUTION", taxable = true) => db.salaryComponent.create({ data: { code, name, kind, taxable } });
  const C = {
    DA: await comp("DA", "Dearness allowance", "EARNING"),
    HRA: await comp("HRA", "House rent allowance", "EARNING"),
    TA: await comp("TA", "Transport allowance", "EARNING", false),
    PF: await comp("PF", "Provident fund (employee)", "DEDUCTION", false),
    PT: await comp("PT", "Professional tax", "DEDUCTION", false),
    TDS: await comp("TDS", "Income tax (TDS)", "DEDUCTION", false),
    EPF: await comp("EPF", "Provident fund (employer)", "EMPLOYER_CONTRIBUTION", false),
  };
  type L = [keyof typeof C, "FIXED" | "PERCENT_OF_BASIC" | "PERCENT_OF_GROSS" | "INCOME_TAX", number, number | null];
  const structure = async (code: string, name: string, lines: L[]) =>
    db.salaryStructure.create({
      data: { code, version: 1, name, status: "ACTIVE", lines: { create: lines.map(([c, calc, value, cap], i) => ({ componentId: C[c].id, calc, value: calc === "FIXED" ? value.toFixed(2) : value.toFixed(4), cap: cap !== null ? cap.toFixed(2) : null, order: i })) } },
      include: { lines: { include: { component: true } } },
    });
  const teachS = await structure("TEACH-7CPC", "Teaching staff (pay level matrix)", [["DA", "PERCENT_OF_BASIC", 53, null], ["HRA", "PERCENT_OF_BASIC", 24, null], ["TA", "FIXED", 3600, null], ["PF", "PERCENT_OF_BASIC", 12, 1800], ["PT", "FIXED", 200, null], ["TDS", "INCOME_TAX", 0, null], ["EPF", "PERCENT_OF_BASIC", 12, 1800]]);
  const staffS = await structure("STAFF-STD", "Administrative staff", [["DA", "PERCENT_OF_BASIC", 53, null], ["HRA", "PERCENT_OF_BASIC", 16, null], ["TA", "FIXED", 1800, null], ["PF", "PERCENT_OF_BASIC", 12, 1800], ["PT", "FIXED", 200, null], ["TDS", "INCOME_TAX", 0, null], ["EPF", "PERCENT_OF_BASIC", 12, 1800]]);
  for (const [h, e] of Object.entries(emp)) {
    await db.employeeSalary.create({ data: { employeeId: e.id, structureId: e.teaching ? teachS.id : staffS.id, basicMonthly: e.basic.toFixed(2), effectiveFrom: h === "setter2" ? d("2026-07-01") : d("2026-04-01"), createdById: s.users.hr.id } });
  }

  // August 2026 payroll: computed with the same rules the application uses, approved and paid.
  const run = await db.payrollRun.create({ data: { period: "2026-08", workingDays: 31, status: "DRAFT", createdById: s.users.hr.id } });
  const slips: { runId: string; employeeId: string; basic: string; gross: string; deductions: string; employerContributions: string; net: string; workingDays: number; lopDays: number; lines: object[]; _p: PayslipResult }[] = [];
  for (const [h, e] of Object.entries(emp)) {
    const st = e.teaching ? teachS : staffS;
    const comps: PayComponent[] = st.lines.map((l) => ({ code: l.component.code, name: l.component.name, kind: l.component.kind, calc: l.calc, value: l.calc === "FIXED" ? toMinor(l.value) : Number(l.value), cap: l.cap ? toMinor(l.cap) : null, taxable: l.component.taxable, order: l.order }));
    const lop = h === "faculty.com1" ? 2 : 0;
    const p = computePayslip({ basicMonthly: e.basic * 100, components: comps, workingDays: 31, payableDays: 31 - lop, tax: TAX });
    slips.push({ runId: run.id, employeeId: e.id, basic: fromMinor(p.basic), gross: fromMinor(p.gross), deductions: fromMinor(p.deductions), employerContributions: fromMinor(p.employerContributions), net: fromMinor(p.net), workingDays: 31, lopDays: lop, lines: p.lines.map((l) => ({ ...l, amount: l.amount / 100 })), _p: p });
  }
  await db.payslip.createMany({ data: slips.map(({ _p, ...x }) => { void _p; return x; }) });
  const tot = (f: (p: PayslipResult) => number) => sum(slips.map((x) => f(x._p)));
  const gross = tot((p) => p.gross), net = tot((p) => p.net), employer = tot((p) => p.employerContributions);
  const tds = tot((p) => p.lines.filter((l) => l.calc === "INCOME_TAX").reduce((a, l) => a + l.amount, 0));
  const statutory = tot((p) => p.deductions) - tds;
  const seq = await db.numberSequence.findUniqueOrThrow({ where: { key: "journal" } });
  const jv = (k: number) => `JV/2026/${String(seq.next + k).padStart(6, "0")}`;
  await db.journalEntry.create({
    data: {
      number: jv(0), date: d("2026-08-31"), memo: "Payroll 2026-08 accrual", sourceType: "payrollRun", sourceId: run.id, postedById: s.users.registrar.id,
      lines: { create: [
        { accountId: accounts["5200"], debit: fromMinor(gross) }, { accountId: accounts["5210"], debit: fromMinor(employer) },
        { accountId: accounts["2300"], credit: fromMinor(net) }, { accountId: accounts["2320"], credit: fromMinor(tds) }, { accountId: accounts["2310"], credit: fromMinor(statutory + employer) },
      ].filter((l) => Number(l.debit ?? l.credit) > 0) },
    },
  });
  await db.journalEntry.create({
    data: { number: jv(1), date: d("2026-09-01"), memo: "Payroll 2026-08 paid (NEFT batch 20260901-01)", sourceType: "payrollRun", sourceId: run.id, postedById: s.users.accounts.id, lines: { create: [{ accountId: accounts["2300"], debit: fromMinor(net) }, { accountId: accounts["1110"], credit: fromMinor(net) }] } },
  });
  await db.numberSequence.update({ where: { key: "journal" }, data: { next: seq.next + 2 } });
  const totals = { employees: slips.length, skipped: [], gross: gross / 100, deductions: tot((p) => p.deductions) / 100, net: net / 100, employerContributions: employer / 100 };
  await db.payrollRun.update({ where: { id: run.id }, data: { status: "COMPUTED", computedAt: d("2026-08-28"), totals } });
  await db.payrollRun.update({ where: { id: run.id }, data: { status: "IN_APPROVAL" } });
  await db.payrollRun.update({ where: { id: run.id }, data: { status: "APPROVED", approvedAt: d("2026-08-30") } });
  await db.payrollRun.update({ where: { id: run.id }, data: { status: "PAID", paidAt: d("2026-09-01"), paymentRef: "NEFT batch 20260901-01" } });
  await db.numberSequence.create({ data: { key: "employee", prefix: "EMP{YY}", next: 1, padding: 4 } });
}
