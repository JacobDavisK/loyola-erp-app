/**
 * University-platform demo data layered on top of the examination seed (prisma/seed.ts).
 * Every person is fictional; names are generic and e-mail addresses use the reserved example.edu domain.
 */
import type { PrismaClient } from "../src/generated/prisma/client";
import type { SystemRoleKey } from "../src/lib/domain/permissions";
import { seedFinance } from "./seed-finance";
import { seedHr } from "./seed-hr";
import { seedLms } from "./seed-lms";
import { seedQuality } from "./seed-quality";
import { seedCampus } from "./seed-campus";

export interface SeedContext {
  db: PrismaClient;
  passwordHash: string;
  institutionId: string;
  dept: Record<string, string>;
  prog: Record<string, string>;
  sem: Record<number, string>;
  roleId: Record<SystemRoleKey, string>;
  users: Record<string, { id: string; name: string }>;
  courses: Record<string, { id: string; dept: string }>;
  academicYears: { previous: string; current: string };
  regulationId: string;
  now: Date;
  auditLog: (e: { actorId?: string | null; actorName?: string | null; action: string; resourceType: string; resourceId?: string | null; summary?: string; newValue?: unknown; createdAt?: Date }) => Promise<void>;
}

type Grant = { role: SystemRoleKey; dept?: string; unit?: string; campus?: string };

export async function seedErp(s: SeedContext) {
  const { db } = s;
  console.log("› campuses, faculties & schools");
  const main = await db.campus.create({ data: { institutionId: s.institutionId, code: "MAIN", name: "Main Campus", address: "University Road, Knowledge City", isMain: true } });
  const city = await db.campus.create({ data: { institutionId: s.institutionId, code: "CITY", name: "City Campus", address: "Civic Centre, Knowledge City" } });
  const unit = async (code: string, name: string, type: "FACULTY" | "SCHOOL" | "CENTRE", campusId: string | null, parentId: string | null = null) =>
    (await db.academicUnit.create({ data: { institutionId: s.institutionId, code, name, type, campusId, parentId } })).id;
  const fsci = await unit("FSCI", "Faculty of Science", "FACULTY", main.id);
  const soc = await unit("SOC", "School of Computing", "SCHOOL", main.id, fsci);
  const sps = await unit("SPS", "School of Physical Sciences", "SCHOOL", main.id, fsci);
  const fcm = await unit("FCM", "Faculty of Commerce & Management", "FACULTY", city.id);
  await unit("CIQA", "Centre for Internal Quality Assurance", "CENTRE", main.id);
  const units = { FSCI: fsci, SOC: soc, SPS: sps, FCM: fcm };
  const deptPlacement: Record<string, [string, string]> = { CS: [soc, main.id], MAT: [sps, main.id], PHY: [sps, main.id], COM: [fcm, city.id], MGT: [fcm, city.id] };
  for (const [code, [unitId, campusId]] of Object.entries(deptPlacement)) {
    await db.department.update({ where: { id: s.dept[code] }, data: { academicUnitId: unitId, campusId } });
  }

  console.log("› university staff accounts");
  const staff: [handle: string, name: string, emp: string, designation: string, dept: string | null, grants: Grant[]][] = [
    ["registrar", "Dr. Priya Raman", "EMP0901", "Registrar", null, [{ role: "REGISTRAR" }]],
    ["uniadmin", "Suresh Pillai", "EMP0902", "Deputy Registrar (Administration)", null, [{ role: "UNIVERSITY_ADMIN" }]],
    ["itadmin", "Nikhil Rao", "EMP0903", "Systems Manager", null, [{ role: "IT_ADMIN" }]],
    ["dean.science", "Dr. Kavya Menon", "EMP0801", "Dean, Faculty of Science", null, [{ role: "DEAN", unit: "FSCI" }]],
    ["principal.city", "Dr. Omar Qureshi", "EMP0802", "Principal, City Campus", null, [{ role: "PRINCIPAL", campus: "CITY" }]],
    ["faculty.cs1", "Anita George", "EMP2201", "Assistant Professor", "CS", [{ role: "FACULTY", dept: "CS" }]],
    ["faculty.cs2", "Rohan Das", "EMP2202", "Assistant Professor", "CS", [{ role: "FACULTY", dept: "CS" }]],
    ["faculty.com1", "Meena Joseph", "EMP2203", "Assistant Professor", "COM", [{ role: "FACULTY", dept: "COM" }]],
    ["finance", "Ravi Shankar", "EMP0701", "Finance Officer", null, [{ role: "FINANCE_OFFICER" }]],
    ["accounts", "Latha Menon", "EMP0702", "Accounts Officer", null, [{ role: "ACCOUNTS_OFFICER" }]],
    ["hr", "Deepa Krishnan", "EMP0601", "HR Manager", null, [{ role: "HR_OFFICER" }]],
    ["research", "Dr. Arvind Menon", "EMP0501", "Dean of Research", null, [{ role: "RESEARCH_DEAN" }]],
    ["iqac", "Dr. Shalini Gupta", "EMP0502", "IQAC Coordinator", null, [{ role: "IQAC_COORDINATOR" }]],
    ["librarian", "Rekha Nambiar", "EMP0401", "Librarian", null, [{ role: "LIBRARIAN" }]],
    ["warden", "Joseph Kurian", "EMP0402", "Chief Warden", null, [{ role: "HOSTEL_WARDEN" }]],
    ["transport", "Manoj Varma", "EMP0403", "Transport Officer", null, [{ role: "TRANSPORT_OFFICER" }]],
    ["helpdesk", "Asha Pillai", "EMP0404", "Helpdesk Executive", null, [{ role: "HELPDESK_AGENT" }]],
    ["admissions", "Vinod Kumar", "EMP0405", "Admissions Officer", null, [{ role: "ADMISSIONS_OFFICER" }]],
    ["placement", "Dr. Neha Joshi", "EMP0406", "Training & Placement Officer", null, [{ role: "PLACEMENT_OFFICER" }]],
  ];
  const campusIds: Record<string, string> = { MAIN: main.id, CITY: city.id };
  for (const [handle, name, emp, designation, d, grants] of staff) {
    const u = await db.user.create({
      data: {
        email: `${handle}@example.edu`,
        employeeId: emp,
        name,
        designation,
        phone: `+91 90000 ${emp.slice(3)}0`,
        passwordHash: s.passwordHash,
        departmentId: d ? s.dept[d] : null,
        lastLoginAt: new Date(s.now.getTime() - 86_400_000),
        roles: {
          create: grants.map((g) => ({
            roleId: s.roleId[g.role],
            departmentId: g.dept ? s.dept[g.dept] : null,
            academicUnitId: g.unit ? units[g.unit as keyof typeof units] : null,
            campusId: g.campus ? campusIds[g.campus] : null,
          })),
        },
      },
    });
    s.users[handle] = { id: u.id, name };
  }
  // Existing departmental staff also teach.
  for (const handle of ["hod.cs", "setter", "setter2"]) {
    await db.userRole.create({ data: { userId: s.users[handle].id, roleId: s.roleId.FACULTY, departmentId: s.dept.CS } });
  }
  for (const handle of ["hod.commerce", "setter3", "setter4"]) {
    await db.userRole.create({ data: { userId: s.users[handle].id, roleId: s.roleId.FACULTY, departmentId: s.dept.COM } });
  }

  console.log("› workflow definitions");
  // Version 1 of each registered workflow is created on first use; the demo publishes the access
  // workflow explicitly and leaves one request waiting for the HoD so the approval centre has content.
  const def = await db.workflowDefinition.create({
    data: {
      key: "access.request",
      version: 1,
      name: "Access request",
      module: "Identity & access",
      description: "A staff member asks for an additional role. The grant is created automatically on approval and can expire.",
      steps: [
        { key: "hod", name: "Head of department review", approvers: [{ type: "role", role: "HOD", scope: "subject_department" }], mode: "ANY", condition: { field: "departmentScoped", op: "eq", value: true }, slaHours: 48, allowReturn: true, allowDelegate: true },
        { key: "security", name: "Security approval", approvers: [{ type: "role", role: "SUPER_ADMIN", scope: "global" }, { type: "role", role: "IT_ADMIN", scope: "global" }], mode: "ANY", slaHours: 72, allowReturn: true, allowDelegate: false },
      ],
    },
  });
  const requester = s.users["faculty.cs1"];
  const inst = await db.workflowInstance.create({
    data: {
      definitionId: def.id,
      key: "access.request",
      module: "Identity & access",
      resourceType: "accessRequest",
      resourceId: `${requester.id}:${s.roleId.MODERATOR}:${s.dept.CS}`,
      title: `Question Paper Moderator for ${requester.name}`,
      summary: "Computer Science · until 2027-01-31 — Appointed internal moderator for the November 2026 session.",
      departmentId: s.dept.CS,
      subjectUserId: requester.id,
      initiatorId: requester.id,
      data: {
        userId: requester.id, userName: requester.name, roleId: s.roleId.MODERATOR, roleKey: "MODERATOR", roleName: "Question Paper Moderator",
        scopeType: "department", departmentId: s.dept.CS, academicUnitId: null, campusId: null, scopeLabel: "Computer Science",
        validUntil: "2027-01-31T00:00:00.000Z", reason: "Appointed internal moderator for the November 2026 session.", departmentScoped: true,
      },
      createdAt: new Date(s.now.getTime() - 26 * 3_600_000),
    },
  });
  await db.workflowAction.create({ data: { instanceId: inst.id, actorId: requester.id, action: "start", createdAt: inst.createdAt } });
  const task = await db.workflowTask.create({
    data: { instanceId: inst.id, stepIndex: 0, stepKey: "hod", stepName: "Head of department review", assigneeId: s.users["hod.cs"].id, dueAt: new Date(inst.createdAt.getTime() + 48 * 3_600_000), createdAt: inst.createdAt },
  });
  await db.notification.create({ data: { userId: s.users["hod.cs"].id, type: "workflow.task", title: `Approval needed: ${inst.title}`, body: `Head of department review · requested by ${requester.name}`, link: `/inbox/${task.id}`, createdAt: inst.createdAt } });

  await seedAcademicCore(s, { main: main.id, city: city.id });
  return { campuses: { MAIN: main.id, CITY: city.id }, units };
}

// ───────────────────────── Phase 2: academic core ─────────────────────────

/** Deterministic PRNG so the demo data is identical on every seed. */
function rng(seed: number) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Aarav", "Diya", "Ishaan", "Meera", "Kabir", "Ananya", "Vihaan", "Saanvi", "Arjun", "Myra", "Reyansh", "Aadhya", "Advait", "Kiara", "Dhruv", "Navya", "Krish", "Anika", "Shaurya", "Ira", "Nikhil", "Tara", "Rohan", "Zara", "Aditya", "Riya", "Siddharth", "Nisha", "Varun", "Pooja", "Farhan", "Leela", "Joel", "Neha", "Imran", "Sneha"];
const LAST = ["Sharma", "Nair", "Iyer", "Menon", "Rao", "Pillai", "Das", "Khan", "Joseph", "Reddy", "Gupta", "Kumar", "Varghese", "Bhat", "Chandra", "Thomas", "Singh", "Mathew", "George", "Krishnan"];

async function seedAcademicCore(s: SeedContext, campus: { main: string; city: string }) {
  const { db } = s;
  const r = rng(20260926);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const TZ = "Asia/Kolkata";

  console.log("› terms, calendar, rooms");
  const t2425o = await db.academicTerm.create({ data: { academicYearId: s.academicYears.previous, code: "2025-26-ODD", name: "2025–26 Odd term", termType: "ODD", startDate: d("2025-07-01"), endDate: d("2025-11-15"), status: "COMPLETED" } });
  const t2526e = await db.academicTerm.create({ data: { academicYearId: s.academicYears.previous, code: "2025-26-EVEN", name: "2025–26 Even term", termType: "EVEN", startDate: d("2025-12-15"), endDate: d("2026-04-15"), status: "COMPLETED" } });
  const term = await db.academicTerm.create({
    data: {
      academicYearId: s.academicYears.current, code: "2026-27-ODD", name: "2026–27 Odd term", termType: "ODD", startDate: d("2026-07-01"), endDate: d("2026-11-14"),
      registrationOpensAt: new Date("2026-06-15T03:30:00Z"), registrationClosesAt: new Date("2026-07-10T12:30:00Z"), addDropUntil: new Date(s.now.getTime() + 10 * 86_400_000),
      status: "IN_PROGRESS", isCurrent: true,
    },
  });
  await db.academicTerm.create({
    data: {
      academicYearId: s.academicYears.current, code: "2026-27-EVEN", name: "2026–27 Even term", termType: "EVEN", startDate: d("2026-12-14"), endDate: d("2027-04-17"),
      registrationOpensAt: new Date("2026-11-23T03:30:00Z"), registrationClosesAt: new Date("2026-12-18T12:30:00Z"), status: "PLANNED",
    },
  });
  const holidays: [string, string, string][] = [["Gandhi Jayanti", "2026-10-02", "2026-10-02"], ["Dussehra", "2026-10-20", "2026-10-20"], ["Deepavali", "2026-11-08", "2026-11-09"], ["Independence Day", "2026-08-15", "2026-08-15"], ["Onam", "2026-08-26", "2026-08-26"]];
  for (const [title, a, b] of holidays) await db.calendarEvent.create({ data: { title, kind: "HOLIDAY", isHoliday: true, startDate: d(a), endDate: d(b), termId: term.id } });
  await db.calendarEvent.create({ data: { title: "Continuous assessment test II", kind: "EXAMINATION", startDate: d("2026-10-05"), endDate: d("2026-10-09"), termId: term.id, description: "Internal tests; classes as per the test schedule." } });
  await db.calendarEvent.create({ data: { title: "End-semester examinations (November 2026 session)", kind: "EXAMINATION", startDate: d("2026-11-16"), endDate: d("2026-12-05"), termId: term.id } });
  await db.calendarEvent.create({ data: { title: "Last date for add/drop", kind: "DEADLINE", startDate: term.addDropUntil!, endDate: term.addDropUntil!, termId: term.id } });
  await db.calendarEvent.create({ data: { title: "Even-term course registration", kind: "REGISTRATION", startDate: d("2026-11-23"), endDate: d("2026-12-18") } });

  const ab = await db.building.create({ data: { code: "AB", name: "Academic Block", campusId: campus.main } });
  const sb = await db.building.create({ data: { code: "SB", name: "Science Block", campusId: campus.main } });
  const cb = await db.building.create({ data: { code: "CB", name: "Commerce Block", campusId: campus.city } });
  const room: Record<string, string> = {};
  for (const [code, name, b, type, cap, exam] of [
    ["AB-101", "Lecture hall 101", ab.id, "CLASSROOM", 70, 35], ["AB-102", "Lecture hall 102", ab.id, "CLASSROOM", 70, 35], ["AB-201", "Lecture hall 201", ab.id, "CLASSROOM", 60, 30],
    ["AB-301", "Seminar hall", ab.id, "SEMINAR_HALL", 120, 60], ["SB-L1", "Computing lab 1", sb.id, "LAB", 40, null], ["SB-L2", "Computing lab 2", sb.id, "LAB", 40, null],
    ["SB-EH", "Examination hall", sb.id, "EXAM_HALL", 150, 150], ["CB-11", "Classroom 11", cb.id, "CLASSROOM", 70, 35], ["CB-12", "Classroom 12", cb.id, "CLASSROOM", 70, 35],
  ] as const) {
    room[code] = (await db.room.create({ data: { code, name, buildingId: b, type, capacity: cap, examCapacity: exam } })).id;
  }

  console.log("› batches & curriculum");
  const batch = async (code: string, prog: string, year: number, years: number) =>
    (await db.batch.create({ data: { code, name: `${prog} ${year}–${String(year + years).slice(2)}`, programId: s.prog[prog], regulationId: s.regulationId, admissionYear: year, graduationYear: year + years } })).id;
  const bca24 = await batch("BCA-2024", "BCA", 2024, 3);
  const bca25 = await batch("BCA-2025", "BCA", 2025, 3);
  const bca26 = await batch("BCA-2026", "BCA", 2026, 3);
  const bcom25 = await batch("BCOM-2025", "BCOM", 2025, 3);

  const curriculum = await db.curriculum.create({
    data: {
      programId: s.prog.BCA, regulationId: s.regulationId, version: 1, name: "BCA (LOCF 2023)", totalCredits: 30, minCgpa: 5, status: "ACTIVE",
      requirements: [{ kind: "CATEGORY_CREDITS", label: "Skill-enhancement / lab", courseTypes: ["SKILL_ENHANCEMENT"], minCredits: 2 }],
    },
  });
  const dse = await db.electiveGroup.create({ data: { curriculumId: curriculum.id, code: "DSE", name: "Discipline-specific elective", minCredits: 4 } });
  for (const [code, sem, cat] of [["BCS101", 1, "MANDATORY"], ["BCS301", 3, "MANDATORY"], ["BCS302", 3, "MANDATORY"], ["BCS303", 3, "MANDATORY"], ["BCS302P", 3, "MANDATORY"], ["BCS304", 3, "ELECTIVE"], ["BCS501", 5, "MANDATORY"], ["BCS502", 5, "MANDATORY"]] as const) {
    await db.curriculumCourse.create({ data: { curriculumId: curriculum.id, courseId: s.courses[code].id, semesterNumber: sem, category: cat, groupId: cat === "ELECTIVE" ? dse.id : null } });
  }
  await db.batch.updateMany({ where: { id: { in: [bca24, bca25, bca26] } }, data: { curriculumId: curriculum.id } });
  await db.coursePrerequisite.createMany({ data: [
    { courseId: s.courses.BCS301.id, prerequisiteId: s.courses.BCS101.id },
    { courseId: s.courses.BCS501.id, prerequisiteId: s.courses.BCS303.id },
  ] });

  console.log("› students & guardians");
  const seq: Record<string, number> = {};
  const students: Record<string, { id: string; batch: string; section: string }[]> = {};
  const studentRole = await db.role.findUniqueOrThrow({ where: { key: "STUDENT" } });
  const guardianRole = await db.role.findUniqueOrThrow({ where: { key: "GUARDIAN" } });
  let adm = 0;
  const mk = async (batchKey: string, batchId: string, prog: string, year: number, sem: number, count: number, sections: string[]) => {
    students[batchKey] = [];
    for (let i = 0; i < count; i++) {
      const prefix = `${String(year).slice(2)}${prog}`;
      seq[prefix] = (seq[prefix] ?? 0) + 1;
      const studentNo = `${prefix}${String(seq[prefix]).padStart(4, "0")}`;
      const first = pick(FIRST);
      const last = pick(LAST);
      const section = sections[i % sections.length];
      adm++;
      const st = await db.student.create({
        data: {
          studentNo, admissionNo: `ADM${year}-${String(adm).padStart(5, "0")}`, firstName: first, lastName: last,
          email: `${first}.${last}.${studentNo}`.toLowerCase() + "@students.example.edu", phone: `+91 9${String(100000000 + Math.floor(r() * 899999999))}`,
          dateOfBirth: d(`${year - 18}-${String(1 + Math.floor(r() * 12)).padStart(2, "0")}-${String(1 + Math.floor(r() * 27)).padStart(2, "0")}`),
          gender: r() < 0.5 ? "FEMALE" : "MALE", nationality: "Indian", programId: s.prog[prog], batchId, departmentId: s.dept[prog === "BCOM" ? "COM" : "CS"],
          campusId: prog === "BCOM" ? campus.city : campus.main, section, currentSemester: sem, admittedOn: d(`${year}-07-01`),
          address: { line1: `${10 + Math.floor(r() * 180)}, ${pick(["Lake View Road", "Temple Street", "Station Road", "Park Avenue", "Market Lane"])}`, city: "Knowledge City", state: "Tamil Nadu", postalCode: "600001", country: "India" },
          emergencyContact: { name: `${pick(FIRST)} ${last}`, relation: "Parent", phone: `+91 98${String(10000000 + Math.floor(r() * 89999999))}` },
          guardians: { create: [{ name: `${pick(["Suresh", "Lakshmi", "Rajan", "Geetha", "Mohan", "Anitha"])} ${last}`, relation: r() < 0.5 ? "FATHER" : "MOTHER", phone: `+91 97${String(10000000 + Math.floor(r() * 89999999))}`, isPrimary: true }] },
        },
      });
      students[batchKey].push({ id: st.id, batch: batchId, section });
    }
  };
  await mk("BCA-2024", bca24, "BCA", 2024, 5, 18, ["A"]);
  await mk("BCA-2025", bca25, "BCA", 2025, 3, 24, ["A", "B"]);
  await mk("BCA-2026", bca26, "BCA", 2026, 1, 16, ["A"]);
  await mk("BCOM-2025", bcom25, "BCOM", 2025, 3, 16, ["A"]);
  for (const [prefix, n] of Object.entries(seq)) await db.numberSequence.create({ data: { key: `student.${prefix}`, prefix, next: n + 1, padding: 4 } });
  await db.numberSequence.create({ data: { key: "admission.2026", prefix: "ADM2026-", next: adm + 1, padding: 5 } });

  // Portal accounts for one student and one guardian (sign in as student@example.edu / parent@example.edu).
  const demo = students["BCA-2025"][0];
  const demoStudent = await db.student.findUniqueOrThrow({ where: { id: demo.id } });
  const su = await db.user.create({
    data: { email: "student@example.edu", employeeId: demoStudent.studentNo, name: `${demoStudent.firstName} ${demoStudent.lastName}`, userType: "STUDENT", departmentId: demoStudent.departmentId, passwordHash: s.passwordHash, roles: { create: [{ roleId: studentRole.id }] } },
  });
  await db.student.update({ where: { id: demo.id }, data: { userId: su.id, email: "student@example.edu" } });
  const g = await db.guardian.findFirstOrThrow({ where: { studentId: demo.id } });
  const gu = await db.user.create({ data: { email: "parent@example.edu", employeeId: "G000001", name: g.name, userType: "GUARDIAN", passwordHash: s.passwordHash, roles: { create: [{ roleId: guardianRole.id }] } } });
  await db.guardian.update({ where: { id: g.id }, data: { userId: gu.id, email: "parent@example.edu", canViewFinance: true } });
  await db.numberSequence.create({ data: { key: "guardian.login", prefix: "G", next: 2, padding: 6 } });

  console.log("› classes, timetable, registrations & attendance");
  type OfferingSpec = { course: string; batchKey: string; batchId: string; section: string; teachers: string[]; slots: [number, string, string, string, "LECTURE" | "LAB"][] };
  const specs: OfferingSpec[] = [
    { course: "BCS301", batchKey: "BCA-2025", batchId: bca25, section: "A", teachers: ["setter"], slots: [[1, "09:00", "10:00", "AB-101", "LECTURE"], [3, "09:00", "10:00", "AB-101", "LECTURE"], [5, "11:00", "12:00", "AB-101", "LECTURE"]] },
    { course: "BCS302", batchKey: "BCA-2025", batchId: bca25, section: "A", teachers: ["hod.cs"], slots: [[1, "10:00", "11:00", "AB-101", "LECTURE"], [2, "09:00", "10:00", "AB-101", "LECTURE"], [4, "11:00", "12:00", "AB-101", "LECTURE"]] },
    { course: "BCS303", batchKey: "BCA-2025", batchId: bca25, section: "A", teachers: ["setter2"], slots: [[2, "10:00", "11:00", "AB-101", "LECTURE"], [4, "09:00", "10:00", "AB-101", "LECTURE"], [5, "09:00", "10:00", "AB-101", "LECTURE"]] },
    { course: "BCS304", batchKey: "BCA-2025", batchId: bca25, section: "A", teachers: ["faculty.cs1"], slots: [[1, "11:30", "12:30", "AB-102", "LECTURE"], [3, "11:30", "12:30", "AB-102", "LECTURE"]] },
    { course: "BCS302P", batchKey: "BCA-2025", batchId: bca25, section: "A", teachers: ["faculty.cs2", "hod.cs"], slots: [[3, "14:00", "16:00", "SB-L1", "LAB"]] },
    { course: "BCS501", batchKey: "BCA-2024", batchId: bca24, section: "A", teachers: ["faculty.cs2"], slots: [[1, "09:00", "10:00", "AB-201", "LECTURE"], [3, "10:00", "11:00", "AB-201", "LECTURE"], [5, "10:00", "11:00", "AB-201", "LECTURE"]] },
    { course: "BCS502", batchKey: "BCA-2024", batchId: bca24, section: "A", teachers: ["setter2"], slots: [[2, "11:00", "12:00", "AB-201", "LECTURE"], [4, "10:00", "11:00", "AB-201", "LECTURE"]] },
    { course: "BCS101", batchKey: "BCA-2026", batchId: bca26, section: "A", teachers: ["faculty.cs1"], slots: [[2, "14:00", "15:00", "AB-102", "LECTURE"], [4, "14:00", "15:00", "AB-102", "LECTURE"], [5, "14:00", "16:00", "SB-L2", "LAB"]] },
    { course: "BCM301", batchKey: "BCOM-2025", batchId: bcom25, section: "A", teachers: ["faculty.com1"], slots: [[1, "10:00", "11:00", "CB-11", "LECTURE"], [3, "10:00", "11:00", "CB-11", "LECTURE"], [5, "10:00", "11:00", "CB-11", "LECTURE"]] },
    { course: "BCM302", batchKey: "BCOM-2025", batchId: bcom25, section: "A", teachers: ["setter4"], slots: [[2, "10:00", "11:00", "CB-11", "LECTURE"], [4, "10:00", "11:00", "CB-11", "LECTURE"]] },
  ];
  const { generateMeetings, zonedTimeToUtc } = await import("../src/lib/domain/timetable");
  const holidayRows = await db.calendarEvent.findMany({ where: { isHoliday: true } });
  const today = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(s.now) + "T00:00:00Z");
  // A few students with poor attendance so shortage warnings appear.
  const truant = new Set([students["BCA-2025"][3].id, students["BCA-2025"][11].id, students["BCA-2024"][5].id]);
  for (const sp of specs) {
    const o = await db.courseOffering.create({
      data: {
        courseId: s.courses[sp.course].id, termId: term.id, batchId: sp.batchId, section: sp.section, capacity: 60, status: "OPEN",
        instructors: { create: sp.teachers.map((h, i) => ({ userId: s.users[h].id, isPrimary: i === 0 })) },
      },
    });
    const slotRows = [];
    for (const [day, a, b, rm, kind] of sp.slots) slotRows.push(await db.timetableSlot.create({ data: { offeringId: o.id, dayOfWeek: day, startTime: a, endTime: b, roomId: room[rm], kind } }));
    const roster = students[sp.batchKey];
    await db.courseRegistration.createMany({ data: roster.map((st) => ({ studentId: st.id, offeringId: o.id, registeredAt: d("2026-07-02"), registeredById: s.users.registrar.id })) });
    const planned = generateMeetings(slotRows, term.startDate, term.endDate, holidayRows);
    for (const m of planned) {
      const slot = slotRows[m.slotIndex];
      const past = new Date(`${m.date}T00:00:00Z`) < today;
      const meeting = await db.classMeeting.create({
        data: {
          offeringId: o.id, slotId: slot.id, date: new Date(`${m.date}T00:00:00Z`), startsAt: zonedTimeToUtc(m.date, m.startTime, TZ), endsAt: zonedTimeToUtc(m.date, m.endTime, TZ),
          roomId: slot.roomId, kind: slot.kind, status: past ? "HELD" : "SCHEDULED", takenById: past ? s.users[sp.teachers[0]].id : null, takenAt: past ? zonedTimeToUtc(m.date, m.endTime, TZ) : null,
          topic: past ? `Unit ${1 + Math.min(4, Math.floor(((new Date(`${m.date}T00:00:00Z`).getTime() - term.startDate.getTime()) / 86_400_000) / 28))}` : null,
        },
      });
      if (!past) continue;
      await db.attendanceRecord.createMany({
        data: roster.map((st) => {
          const x = r();
          const absentRate = truant.has(st.id) ? 0.38 : 0.1;
          const mark = x < absentRate ? "ABSENT" : x < absentRate + 0.03 ? "LATE" : x < absentRate + 0.04 ? "ON_DUTY" : x < absentRate + 0.045 ? "MEDICAL" : "PRESENT";
          return { meetingId: meeting.id, studentId: st.id, mark, markedById: s.users[sp.teachers[0]].id, markedAt: meeting.endsAt };
        }),
      });
    }
  }
  // Completed history: BCS101 for the 2025 cohort (last odd term); sem-3 courses for the 2024 cohort.
  const past = async (termId: string, course: string, batchKey: string, batchId: string, teacher: string) => {
    const o = await db.courseOffering.create({ data: { courseId: s.courses[course].id, termId, batchId, section: "A", capacity: 60, status: "COMPLETED", instructors: { create: [{ userId: s.users[teacher].id, isPrimary: true }] } } });
    await db.courseRegistration.createMany({ data: students[batchKey].map((st) => ({ studentId: st.id, offeringId: o.id, status: "COMPLETED" as const, registeredAt: termId === t2425o.id ? d("2025-07-02") : d("2025-12-16") })) });
  };
  await past(t2425o.id, "BCS101", "BCA-2025", bca25, "faculty.cs1");
  for (const c of ["BCS301", "BCS302", "BCS303", "BCS302P", "BCS304"]) await past(t2425o.id, c, "BCA-2024", bca24, c === "BCS302" ? "hod.cs" : "setter");
  void t2526e;

  await seedResults(s, { current: term.id, previous: t2425o.id, even: t2526e.id }, students, r);
  await seedFinance(s, { id: term.id, name: term.name }, { bca24, bca25, bca26, bcom25 }, r);
  await seedHr(s, r);
  await seedLms(s, r);
  await seedQuality(s, r);
  await seedCampus(s, r);
}

// ───────────────────────── Phase 3: grading, valuers, marks, published history ─────────────────────────

async function seedResults(
  s: SeedContext,
  terms: { current: string; previous: string; even: string },
  students: Record<string, { id: string; batch: string; section: string }[]>,
  r: () => number,
) {
  const { db } = s;
  const { computeCourse, gpa, cgpa } = await import("../src/lib/domain/grading");
  console.log("› grading scheme, valuers, internal marks & published history");
  const bands = [
    { grade: "O", minPercent: 90, gradePoint: 10, pass: true },
    { grade: "A+", minPercent: 80, gradePoint: 9, pass: true },
    { grade: "A", minPercent: 70, gradePoint: 8, pass: true },
    { grade: "B+", minPercent: 60, gradePoint: 7, pass: true },
    { grade: "B", minPercent: 50, gradePoint: 6, pass: true },
    { grade: "C", minPercent: 45, gradePoint: 5, pass: true },
    { grade: "P", minPercent: 40, gradePoint: 4, pass: true },
    { grade: "RA", minPercent: 0, gradePoint: 0, pass: false },
  ];
  const scheme = await db.gradingScheme.create({
    data: { code: "UG10", version: 1, name: "10-point grading (UG, LOCF 2023)", status: "ACTIVE", bands, passPercent: 40, minExternalPercent: 40, minInternalPercent: 0, graceMaxPerCourse: 3, graceMaxTotal: 6, gpaDecimals: 2 },
  });
  await db.regulation.updateMany({ data: { gradingSchemeId: scheme.id } });
  const spec = { bands, passPercent: 40, minExternalPercent: 40, minInternalPercent: 0, absentGrade: "AB", failGrade: "RA", withheldGrade: "WH", graceMaxPerCourse: 3, gpaDecimals: 2 };

  // Sessions ↔ teaching terms.
  await db.examinationSession.updateMany({ where: { code: { in: ["NOV2026", "DEC2026S"] } }, data: { termId: terms.current } });
  await db.examinationSession.updateMany({ where: { code: "APR2026" }, data: { termId: terms.even } });

  // Valuers (anonymous script valuation) — two internal, one external.
  const valuerRole = await db.role.findUniqueOrThrow({ where: { key: "VALUER" } });
  const externalRole = await db.role.findUniqueOrThrow({ where: { key: "EXTERNAL_EXAMINER" } });
  for (const [handle, name, emp, designation, role] of [
    ["valuer1", "Dr. Suma Rajan", "EMP4001", "Associate Professor", valuerRole.id],
    ["valuer2", "Prof. Anil Kurup", "EMP4002", "Assistant Professor", valuerRole.id],
    ["valuer3", "Dr. Beatrice Fernandes", "EXT4003", "External Examiner", externalRole.id],
  ] as const) {
    const u = await db.user.create({ data: { email: `${handle}@example.edu`, employeeId: emp, name, designation, passwordHash: s.passwordHash, departmentId: s.dept.CS, roles: { create: [{ roleId: role, departmentId: s.dept.CS }] } } });
    s.users[handle] = { id: u.id, name };
  }

  // Internal assessment for BCS301 this term: CAT I approved, CAT II being entered, assignment not started.
  const bcs301 = await db.courseOffering.findFirstOrThrow({ where: { courseId: s.courses.BCS301.id, termId: terms.current } });
  const roster = students["BCA-2025"];
  const cat1 = await db.assessmentComponent.create({ data: { offeringId: bcs301.id, name: "CAT I", kind: "INTERNAL", maxMarks: 50, weight: 10, order: 1, sheet: { create: { status: "APPROVED", submittedAt: new Date(s.now.getTime() - 20 * 86_400_000), submittedById: s.users.setter.id, approvedAt: new Date(s.now.getTime() - 18 * 86_400_000) } } } });
  await db.mark.createMany({ data: roster.map((st, i) => ({ componentId: cat1.id, studentId: st.id, marks: i === 5 ? null : 18 + Math.round(r() * 30), status: i === 5 ? "ABSENT" as const : "PRESENT" as const, enteredById: s.users.setter.id })) });
  const cat2 = await db.assessmentComponent.create({ data: { offeringId: bcs301.id, name: "CAT II", kind: "INTERNAL", maxMarks: 50, weight: 10, order: 2, sheet: { create: {} } } });
  await db.mark.createMany({ data: roster.slice(0, 15).map((st) => ({ componentId: cat2.id, studentId: st.id, marks: 20 + Math.round(r() * 28), enteredById: s.users.setter.id })) });
  await db.assessmentComponent.create({ data: { offeringId: bcs301.id, name: "Assignment", kind: "INTERNAL", maxMarks: 10, weight: 5, order: 3, sheet: { create: {} } } });

  // Published history: the November 2025 session (2025–26 odd term).
  const nov25 = await db.examinationSession.create({
    data: { name: "November 2025 End-Semester Examinations", code: "NOV2025", academicYearId: s.academicYears.previous, termId: terms.previous, termType: "ODD", status: "ARCHIVED", startDate: new Date("2025-11-17"), endDate: new Date("2025-12-05") },
  });
  const pastCourses: [string, string][] = [["BCS101", "BCA-2025"], ["BCS301", "BCA-2024"], ["BCS302", "BCA-2024"], ["BCS303", "BCA-2024"], ["BCS302P", "BCA-2024"], ["BCS304", "BCA-2024"]];
  const run = await db.resultRun.create({ data: { sessionId: nov25.id, programId: s.prog.BCA, termId: terms.previous, gradingSchemeId: scheme.id, status: "PUBLISHED", computedAt: new Date("2025-12-20"), publishedAt: new Date("2025-12-24"), computedById: s.users.controller.id } });
  const perStudent = new Map<string, { courseId: string; credits: number; gradePoint: number; status: "PASS" | "FAIL" | "ABSENT" | "WITHHELD" | "INCOMPLETE" }[]>();
  let pass = 0;
  let total = 0;
  for (const [code, batchKey] of pastCourses) {
    const course = await db.course.findUniqueOrThrow({ where: { id: s.courses[code].id } });
    await db.examination.create({ data: { sessionId: nov25.id, courseId: course.id, maxMarks: 75, durationMinutes: 180, isLocked: true } });
    for (const st of students[batchKey]) {
      const internal = Math.min(course.internalMarks, Math.round((0.55 + r() * 0.45) * course.internalMarks));
      const external = Math.round((0.28 + r() * 0.62) * course.externalMarks);
      const o = computeCourse({ credits: course.credits, internalMax: course.internalMarks, externalMax: course.externalMarks, internal, external, externalAbsent: false }, spec, 6);
      await db.courseResult.create({
        data: {
          runId: run.id, studentId: st.id, courseId: course.id, termId: terms.previous, internalMarks: o.internalMarks, externalMarks: o.externalMarks, graceMarks: o.graceMarks,
          totalMarks: o.totalMarks, maxMarks: o.maxMarks, percent: o.percent, grade: o.grade, gradePoint: o.gradePoint, credits: course.credits, creditPoints: o.creditPoints,
          status: o.status, publishedAt: run.publishedAt,
        },
      });
      (perStudent.get(st.id) ?? perStudent.set(st.id, []).get(st.id)!).push({ courseId: course.id, credits: course.credits, gradePoint: o.gradePoint, status: o.status });
      total++;
      if (o.status === "PASS") pass++;
    }
  }
  for (const [studentId, list] of perStudent) {
    const t = gpa(list);
    const c = cgpa(list.map((x) => ({ ...x, attempt: 1 })));
    await db.termResult.create({
      data: { runId: run.id, studentId, termId: terms.previous, creditsRegistered: t.credits, creditsEarned: t.creditsEarned, creditPoints: t.creditPoints, sgpa: t.gpa, cgpa: c.gpa, cumulativeCredits: c.creditsEarned, status: list.every((x) => x.status === "PASS") ? "PASS" : "FAIL_SOME", publishedAt: run.publishedAt },
    });
  }
  await db.resultRun.update({ where: { id: run.id }, data: { stats: { students: perStudent.size, courses: total, pass, fail: total - pass, passPercent: Math.round((pass / total) * 1000) / 10, warnings: [] } } });
}
