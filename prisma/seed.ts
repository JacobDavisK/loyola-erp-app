/**
 * EXAMCORE demo seed — "University of the World".
 * Development only: wipes and recreates all data. Refuses to run when NODE_ENV=production.
 */
import "dotenv/config";
import { hash } from "@node-rs/argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import type { PaperStatus, QuestionType } from "../src/generated/prisma/enums";
import { toPlainText } from "../src/lib/content/parse";
import { generatePaper, type Candidate } from "../src/lib/domain/generator";
import type { BlueprintSpec } from "../src/lib/domain/paper-types";
import { SYSTEM_ROLES, PERMISSIONS, type SystemRoleKey } from "../src/lib/domain/permissions";
import { buildSnapshot, PAPER_CONTENT_INCLUDE } from "../src/lib/domain/snapshot";
import { canonicalJson, chainHash, sha256 } from "../src/lib/hash";
import { seedErp } from "./seed-erp";
import { B, CORPORATE_ACCOUNTING, D, DATA_STRUCTURES, DBMS, LIGHT_BANKS, OPERATING_SYSTEMS, type CourseBank } from "./seed-data/banks";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data in production.");
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const DEMO_PASSWORD = "Examcore@2026";
const day = 86_400_000;
const NOW = new Date();
const at = (iso: string) => new Date(iso);
const daysFromNow = (n: number) => new Date(NOW.getTime() + n * day);

let auditPrev: string | null = null;
async function auditLog(entry: {
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  summary?: string;
  newValue?: unknown;
  createdAt?: Date;
}) {
  const createdAt = entry.createdAt ?? new Date();
  const newValue = entry.newValue === undefined ? undefined : (JSON.parse(JSON.stringify(entry.newValue)) as Prisma.InputJsonValue);
  const hashValue = chainHash(auditPrev, {
    actorId: entry.actorId ?? null,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId ?? null,
    oldValue: null,
    newValue: newValue ?? null,
    createdAt,
  });
  await db.auditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      actorName: entry.actorName ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      summary: entry.summary,
      newValue,
      ip: "127.0.0.1",
      userAgent: "seed",
      prevHash: auditPrev,
      hash: hashValue,
      createdAt,
    },
  });
  auditPrev = hashValue;
}

async function wipe() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  // TRUNCATE bypasses row-level immutability triggers; acceptable only for a dev reseed.
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

async function main() {
  console.log("› wiping development database");
  await wipe();

  // ── RBAC ───────────────────────────────────────────────────
  console.log("› roles & permissions");
  for (const [key, meta] of Object.entries(PERMISSIONS)) {
    await db.permission.create({ data: { key, module: meta.module, description: meta.description } });
  }
  const perms = await db.permission.findMany();
  const permId = new Map(perms.map((p) => [p.key, p.id]));
  const roleId = {} as Record<SystemRoleKey, string>;
  for (const [key, r] of Object.entries(SYSTEM_ROLES) as [SystemRoleKey, (typeof SYSTEM_ROLES)[SystemRoleKey]][]) {
    const role = await db.role.create({
      data: {
        key,
        name: r.name,
        description: r.description,
        rank: r.rank,
        isSystem: true,
        isGlobal: r.global,
        permissions: { create: r.permissions.map((p) => ({ permissionId: permId.get(p)! })) },
      },
    });
    roleId[key] = role.id;
  }

  // ── Institution & academics ────────────────────────────────
  console.log("› institution & academic structure");
  const inst = await db.institution.create({
    data: {
      name: "University of the World",
      shortName: "UW",
      tagline: "Office of the Controller of Examinations",
      address: "University Road, Knowledge City — 600 001",
      phone: "+91 44 2345 6789",
      email: "coe@example.edu",
      website: "https://www.example.edu",
    },
  });
  const deptData = [
    ["CS", "Computer Science"],
    ["COM", "Commerce"],
    ["MGT", "Management"],
    ["MAT", "Mathematics"],
    ["PHY", "Physics"],
  ] as const;
  const dept: Record<string, string> = {};
  for (const [code, name] of deptData) dept[code] = (await db.department.create({ data: { code, name, institutionId: inst.id } })).id;

  const progData = [
    ["BCA", "Bachelor of Computer Applications", "CS", "UG", 3],
    ["MCA", "Master of Computer Applications", "CS", "PG", 2],
    ["BCOM", "B.Com (General)", "COM", "UG", 3],
    ["MCOM", "M.Com", "COM", "PG", 2],
    ["BBA", "Bachelor of Business Administration", "MGT", "UG", 3],
    ["BSCM", "B.Sc Mathematics", "MAT", "UG", 3],
    ["BSCP", "B.Sc Physics", "PHY", "UG", 3],
  ] as const;
  const prog: Record<string, string> = {};
  for (const [code, name, d, level, years] of progData) {
    prog[code] = (await db.program.create({ data: { code, name, departmentId: dept[d], level, durationYears: years } })).id;
  }
  const r23 = await db.regulation.create({ data: { code: "R2023", name: "LOCF Regulations 2023", effectiveFromYear: 2023, description: "Learning Outcomes-based Curriculum Framework" } });
  await db.regulation.create({ data: { code: "R2020", name: "CBCS Regulations 2020", effectiveFromYear: 2020 } });
  const ay2526 = await db.academicYear.create({ data: { label: "2025-26", startDate: at("2025-06-01"), endDate: at("2026-05-31") } });
  const ay2627 = await db.academicYear.create({ data: { label: "2026-27", startDate: at("2026-06-01"), endDate: at("2027-05-31"), isCurrent: true } });
  const roman = ["I", "II", "III", "IV", "V", "VI"];
  const sem: Record<number, string> = {};
  for (let n = 1; n <= 6; n++) {
    sem[n] = (await db.semester.create({ data: { number: n, name: `Semester ${roman[n - 1]}`, termType: n % 2 ? "ODD" : "EVEN" } })).id;
  }

  // ── Users ──────────────────────────────────────────────────
  console.log("› users");
  const passwordHash = await hash(DEMO_PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 });
  // The Super Admin's sign-in name and password can be set per installation in .env (never committed).
  const adminLogin = process.env.SUPER_ADMIN_LOGIN?.trim() || "EMP1001";
  const adminHash = process.env.SUPER_ADMIN_PASSWORD ? await hash(process.env.SUPER_ADMIN_PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 }) : passwordHash;
  const users: Record<string, { id: string; name: string }> = {};
  const userSpec: [string, string, string, string, string | null, [SystemRoleKey, string | null][]][] = [
    ["admin", "Rahul Menon", adminLogin, "System Administrator", null, [["SUPER_ADMIN", null]]],
    ["controller", "Dr. Meera Krishnan", "EMP1002", "Controller of Examinations", null, [["EXAM_CONTROLLER", null]]],
    ["deputy", "Dr. Arun Prakash", "EMP1003", "Deputy Controller of Examinations", null, [["DEPUTY_CONTROLLER", null]]],
    ["examcell", "Kavitha Suresh", "EMP1004", "Section Officer, Examination Cell", null, [["EXAM_CELL_STAFF", null]]],
    ["approver", "Dr. Rajiv Chandran", "EMP1005", "Dean of Academic Affairs", null, [["APPROVER", null]]],
    ["auditor", "Fatima Sheikh", "EMP1006", "Internal Auditor", null, [["AUDITOR", null]]],
    ["hod.cs", "Dr. Sanjay Iyer", "EMP2001", "Professor & Head", "CS", [["HOD", "CS"], ["SETTER", "CS"]]],
    ["hod.commerce", "Dr. Lakshmi Narayanan", "EMP2002", "Professor & Head", "COM", [["HOD", "COM"]]],
    ["setter", "Dr. Farah Siddiqui", "EMP2101", "Associate Professor", "CS", [["SETTER", "CS"]]],
    ["setter2", "Prof. Vikram Nair", "EMP2102", "Assistant Professor", "CS", [["SETTER", "CS"]]],
    ["setter3", "Dr. Deepa Thomas", "EMP2103", "Associate Professor", "COM", [["SETTER", "COM"]]],
    ["setter4", "Prof. Joseph Mathew", "EMP2104", "Assistant Professor", "COM", [["SETTER", "COM"]]],
    ["setter5", "Dr. Nisha Varma", "EMP2105", "Assistant Professor", "MAT", [["SETTER", "MAT"]]],
    ["setter6", "Prof. Harish Kumar", "EMP2106", "Assistant Professor", "PHY", [["SETTER", "PHY"]]],
    ["setter7", "Dr. Ananya Bose", "EMP2107", "Associate Professor", "MGT", [["SETTER", "MGT"]]],
    ["moderator", "Dr. Ramesh Babu", "EMP3001", "Professor (External Moderator)", "CS", [["MODERATOR", "CS"]]],
    ["moderator2", "Dr. Sunitha Pillai", "EMP3002", "Professor (External Moderator)", "COM", [["MODERATOR", "COM"]]],
    ["scrutiny", "Ganesh Murthy", "EMP3101", "Scrutiny Officer", null, [["SCRUTINY_OFFICER", null]]],
  ];
  for (const [handle, name, emp, designation, d, grants] of userSpec) {
    const u = await db.user.create({
      data: {
        email: `${handle}@example.edu`,
        employeeId: emp,
        name,
        designation,
        phone: handle === "admin" ? "+91 9810010 1001" : `+91 98${emp.slice(3)}0 1${emp.slice(4)}`,
        passwordHash: handle === "admin" ? adminHash : passwordHash,
        departmentId: d ? dept[d] : null,
        lastLoginAt: daysFromNow(-1),
        roles: { create: grants.map(([role, gd]) => ({ roleId: roleId[role], departmentId: gd ? dept[gd] : null })) },
      },
    });
    users[handle] = { id: u.id, name };
  }

  // ── Courses ────────────────────────────────────────────────
  console.log("› courses, units and outcomes");
  type CourseRow = [code: string, title: string, dept: string, program: string, semester: number, credits: number, type: Prisma.CourseCreateInput["courseType"]];
  const courseRows: CourseRow[] = [
    ["BCS301", "Data Structures", "CS", "BCA", 3, 4, "CORE"],
    ["BCS302", "Database Management Systems", "CS", "BCA", 3, 4, "CORE"],
    ["BCS303", "Operating Systems", "CS", "BCA", 3, 4, "CORE"],
    ["BCS304", "Object Oriented Programming with Java", "CS", "BCA", 3, 4, "CORE"],
    ["BCS501", "Computer Networks", "CS", "BCA", 5, 4, "CORE"],
    ["BCS502", "Software Engineering", "CS", "BCA", 5, 4, "CORE"],
    ["BCS101", "Programming in C", "CS", "BCA", 1, 4, "CORE"],
    ["MCA101", "Advanced Algorithms", "CS", "MCA", 1, 4, "CORE"],
    ["BCM301", "Corporate Accounting", "COM", "BCOM", 3, 5, "CORE"],
    ["BCM302", "Business Statistics", "COM", "BCOM", 3, 4, "ALLIED"],
    ["BCM101", "Financial Accounting I", "COM", "BCOM", 1, 5, "CORE"],
    ["BCM501", "Income Tax Law and Practice I", "COM", "BCOM", 5, 5, "CORE"],
    ["MCM101", "Advanced Financial Management", "COM", "MCOM", 1, 5, "CORE"],
    ["BBA301", "Organisational Behaviour", "MGT", "BBA", 3, 4, "CORE"],
    ["BBA101", "Principles of Management", "MGT", "BBA", 1, 4, "CORE"],
    ["BMA301", "Real Analysis I", "MAT", "BSCM", 3, 5, "CORE"],
    ["BMA101", "Calculus", "MAT", "BSCM", 1, 5, "CORE"],
    ["BPH301", "Mechanics", "PHY", "BSCP", 3, 4, "CORE"],
    ["BPH101", "Properties of Matter", "PHY", "BSCP", 1, 4, "CORE"],
    ["BCS302P", "Database Laboratory", "CS", "BCA", 3, 2, "SKILL_ENHANCEMENT"],
  ];
  const courses: Record<string, { id: string; dept: string; units: Record<number, { id: string; topics: string[] }>; outcomes: Record<string, string> }> = {};
  const deepBanks: Record<string, CourseBank> = { BCS301: DATA_STRUCTURES, BCS302: DBMS, BCS303: OPERATING_SYSTEMS, BCM301: CORPORATE_ACCOUNTING };
  for (const [code, title, d, p, s, credits, courseType] of courseRows) {
    const practical = code.endsWith("P");
    const course = await db.course.create({
      data: {
        code,
        title,
        credits,
        courseType,
        mode: practical ? "PRACTICAL" : "THEORY",
        departmentId: dept[d],
        programId: prog[p],
        semesterId: sem[s],
        regulationId: r23.id,
        maxMarks: 100,
        internalMarks: 25,
        externalMarks: 75,
        durationMinutes: 180,
        syllabus: `${title} — ${credits} credits. Five units as prescribed by the Board of Studies, ${deptData.find((x) => x[0] === d)![1]}.`,
      },
    });
    const bank = deepBanks[code];
    const unitTitles = bank ? bank.units.map((u) => u.title) : (LIGHT_BANKS[code]?.units ?? ["Unit I", "Unit II", "Unit III", "Unit IV", "Unit V"]);
    const units: Record<number, { id: string; topics: string[] }> = {};
    for (let i = 0; i < unitTitles.length; i++) {
      const topics = bank?.units[i].topics ?? [];
      const unit = await db.courseUnit.create({
        data: {
          courseId: course.id,
          number: i + 1,
          title: unitTitles[i],
          hours: 12,
          topics: { create: topics.map((t, order) => ({ title: t, order })) },
        },
        include: { topics: { orderBy: { order: "asc" } } },
      });
      units[i + 1] = { id: unit.id, topics: unit.topics.map((t) => t.id) };
    }
    const outcomes: Record<string, string> = {};
    const coList = bank?.outcomes ?? [
      ["CO1", `Recall the fundamental concepts of ${title}`, "REMEMBER"],
      ["CO2", `Explain the principles underlying ${title}`, "UNDERSTAND"],
      ["CO3", `Apply the techniques of ${title} to problems`, "APPLY"],
    ];
    for (const [c, description, bloom] of coList) {
      outcomes[c] = (await db.learningOutcome.create({ data: { courseId: course.id, code: c, description, bloom } })).id;
    }
    courses[code] = { id: course.id, dept: d, units, outcomes };
  }

  // ── Question bank ─────────────────────────────────────────
  console.log("› question bank");
  const tagNames = ["previous-year", "conceptual", "numerical", "diagram", "algorithm", "theory", "case-based", "LOCF"];
  const tags: Record<string, string> = {};
  for (const t of tagNames) tags[t] = (await db.tag.create({ data: { name: t } })).id;

  let qSeq = 0;
  const questionIds: Record<string, string[]> = {};
  const authorFor: Record<string, string> = {
    CS: users["hod.cs"].id,
    COM: users["setter3"].id,
    MGT: users["setter7"].id,
    MAT: users["setter5"].id,
    PHY: users["setter6"].id,
  };
  async function createQuestion(
    courseCode: string,
    unitNo: number,
    topicIdx: number | null,
    marks: number,
    diff: keyof typeof D,
    bloom: keyof typeof B,
    type: QuestionType,
    co: string | null,
    body: string,
    authorId: string,
  ) {
    const c = courses[courseCode];
    const plain = toPlainText(body);
    const tagList = [
      type === "NUMERICAL" || type === "PROBLEM" ? "numerical" : "theory",
      marks >= 10 ? "conceptual" : null,
      /algorithm/i.test(body) ? "algorithm" : null,
      /diagram|draw/i.test(body) ? "diagram" : null,
      "LOCF",
    ].filter(Boolean) as string[];
    const keywords = [...new Set(plain.toLowerCase().match(/[a-z]{6,}/g) ?? [])].slice(0, 6);
    qSeq++;
    const created = daysFromNow(-200 + qSeq);
    const q = await db.question.create({
      data: {
        code: `Q-${String(qSeq).padStart(6, "0")}`,
        courseId: c.id,
        unitId: c.units[unitNo].id,
        topicId: topicIdx != null ? (c.units[unitNo].topics[topicIdx] ?? null) : null,
        outcomeId: co ? (c.outcomes[co] ?? null) : null,
        type,
        bloom: B[bloom],
        difficulty: D[diff],
        marks,
        estimatedMinutes: marks === 2 ? 3 : marks === 5 ? 9 : 18,
        status: "ACTIVE",
        authorId,
        plainText: plain,
        searchText: `${plain} ${keywords.join(" ")} ${tagList.join(" ")}`,
        keywords,
        createdAt: created,
        versions: {
          create: {
            version: 1,
            body,
            marks,
            difficulty: D[diff],
            bloom: B[bloom],
            type,
            createdById: authorId,
            changeNote: "Initial version",
            createdAt: created,
          },
        },
        tags: { create: tagList.map((t) => ({ tagId: tags[t] })) },
      },
    });
    (questionIds[courseCode] ??= []).push(q.id);
    return q;
  }
  for (const [code, bank] of Object.entries(deepBanks)) {
    const author = authorFor[courses[code].dept];
    for (const [unit, topic, marks, diff, bloom, type, co, text] of bank.questions) {
      await createQuestion(code, unit, topic, marks, diff, bloom, type, co, text, code === "BCS301" && qSeq % 3 === 0 ? users.setter.id : author);
    }
  }
  for (const [code, bank] of Object.entries(LIGHT_BANKS)) {
    for (const [unit, marks, diff, bloom, type, text] of bank.questions) {
      await createQuestion(code, unit, null, marks, diff, bloom, type, null, text, authorFor[courses[code].dept]);
    }
  }
  // A pending contribution and a retired question for realism
  const pending = await createQuestion("BCS301", 2, 1, 5, "M", "Ap", "PROBLEM", "CO2", "Convert the prefix expression $* + A B - C D$ into infix and postfix forms.", users.setter2.id);
  await db.question.update({ where: { id: pending.id }, data: { status: "PENDING_REVIEW" } });
  const retired = await createQuestion("BCS301", 1, 0, 2, "E", "R", "VERY_SHORT", "CO1", "What is an algorithm?", users["hod.cs"].id);
  await db.question.update({ where: { id: retired.id }, data: { status: "RETIRED" } });

  // ── Templates, watermarks, settings ───────────────────────
  console.log("› templates & watermarks");
  const template = await db.template.create({
    data: {
      name: "University end-semester paper (A4)",
      kind: "PAPER",
      isDefault: true,
      headerTitle: "EXAMPLE UNIVERSITY",
      headerSubtitle: "Office of the Controller of Examinations",
      instructions: "Answer the questions as directed in each section.\nWrite your register number on the question paper immediately after receiving it.\nUse of non-programmable scientific calculators is permitted.",
      footerText: "Confidential — University of the World Examination Cell",
      fontFamily: "Times New Roman",
      fontSizePt: 12,
      marginMm: 18,
    },
  });
  await db.template.create({
    data: {
      name: "Practical examination (A4)",
      kind: "PAPER",
      headerTitle: "EXAMPLE UNIVERSITY",
      headerSubtitle: "Practical Examinations",
      instructions: "Record your observations in the answer booklet.\nViva-voce will be conducted after the experiment.",
      footerText: "Confidential",
      showRegNoBoxes: true,
    },
  });
  await db.watermark.create({
    data: { name: "Confidential banner", text: "CONFIDENTIAL · UNIVERSITY EXAMINATION CELL · DO NOT DISTRIBUTE", appliesTo: ["DRAFT_PDF", "MODERATION_PDF", "FINAL_PDF"], opacity: 0.07, angle: -30 },
  });
  await db.watermark.create({
    data: { name: "Viewer trace", text: "CONFIDENTIAL — {USER} · {SESSION} · {TIMESTAMP}", appliesTo: ["PREVIEW", "DRAFT_PDF", "MODERATION_PDF", "FINAL_PDF"], opacity: 0.09, angle: -30 },
  });
  await db.systemSetting.create({ data: { key: "workflow", value: { allowSelfApproval: false, reuseCoolOffSessions: 2, duplicateThreshold: 0.6, deadlineWarningDays: 3, requireMfaForApproval: false, moderatorsCanEditMetadata: false } } });

  // ── Blueprints ─────────────────────────────────────────────
  console.log("› blueprints");
  const patternSections = [
    { label: "A", title: "Answer ALL questions", questionCount: 10, attemptCount: 10, marksPerQuestion: 2, units: [1, 2, 3, 4, 5], instructions: "Answer ALL questions. Each question carries 2 marks." },
    { label: "B", title: "Answer any FIVE questions", questionCount: 7, attemptCount: 5, marksPerQuestion: 5, units: [1, 2, 3, 4, 5], instructions: "Answer any FIVE questions. Each question carries 5 marks." },
    { label: "C", title: "Answer any THREE questions", questionCount: 5, attemptCount: 3, marksPerQuestion: 10, units: [1, 2, 3, 4, 5], instructions: "Answer any THREE questions. Each question carries 10 marks." },
  ];
  const patternRules: { dimension: "DIFFICULTY" | "BLOOM"; key: string; targetPercent: number; tolerance: number }[] = [
    { dimension: "DIFFICULTY", key: "EASY", targetPercent: 30, tolerance: 8 },
    { dimension: "DIFFICULTY", key: "MODERATE", targetPercent: 50, tolerance: 8 },
    { dimension: "DIFFICULTY", key: "HARD", targetPercent: 20, tolerance: 8 },
    { dimension: "BLOOM", key: "REMEMBER", targetPercent: 20, tolerance: 8 },
    { dimension: "BLOOM", key: "UNDERSTAND", targetPercent: 30, tolerance: 8 },
    { dimension: "BLOOM", key: "APPLY", targetPercent: 30, tolerance: 8 },
    { dimension: "BLOOM", key: "ANALYZE", targetPercent: 20, tolerance: 8 },
  ];
  const makeBlueprint = (name: string, courseId: string | null, isPattern: boolean) =>
    db.blueprint.create({
      data: {
        name,
        description: isPattern ? "Standard LOCF pattern for 75-mark end-semester theory papers (3 hours)." : undefined,
        courseId,
        isPattern,
        totalMarks: 75,
        durationMinutes: 180,
        createdById: users.controller.id,
        sections: { create: patternSections.map((s, order) => ({ ...s, order, questionTypes: [] })) },
        rules: { create: patternRules },
      },
      include: { sections: { orderBy: { order: "asc" } }, rules: true },
    });
  await makeBlueprint("UG Theory — 75 marks (LOCF)", null, true);
  await db.blueprint.create({
    data: {
      name: "PG Theory — 75 marks (LOCF)",
      description: "PG pattern with case-based Section C.",
      isPattern: true,
      totalMarks: 75,
      durationMinutes: 180,
      createdById: users.controller.id,
      sections: {
        create: [
          { order: 0, label: "A", title: "Answer ALL questions", questionCount: 5, attemptCount: 5, marksPerQuestion: 3, units: [], questionTypes: [] },
          { order: 1, label: "B", title: "Answer any FOUR questions", questionCount: 6, attemptCount: 4, marksPerQuestion: 6, units: [], questionTypes: [] },
          { order: 2, label: "C", title: "Answer any TWO questions", questionCount: 3, attemptCount: 2, marksPerQuestion: 18, units: [], questionTypes: ["CASE_STUDY", "ESSAY", "PROBLEM"] },
        ],
      },
    },
  });

  // ── Sessions & examinations ────────────────────────────────
  console.log("› examination sessions");
  const apr = await db.examinationSession.create({
    data: {
      name: "April 2026 End Semester Examinations",
      code: "APR2026",
      academicYearId: ay2526.id,
      termType: "EVEN",
      examType: "REGULAR",
      status: "ARCHIVED",
      startDate: at("2026-04-06"),
      endDate: at("2026-04-28"),
      settingDeadline: at("2026-02-20"),
      moderationDeadline: at("2026-03-02"),
      scrutinyDeadline: at("2026-03-09"),
      approvalDeadline: at("2026-03-16"),
      programs: { connect: [{ id: prog.BCA }] },
    },
  });
  const nov = await db.examinationSession.create({
    data: {
      name: "November 2026 End Semester Examinations",
      code: "NOV2026",
      academicYearId: ay2627.id,
      termType: "ODD",
      examType: "REGULAR",
      status: "PAPER_SETTING",
      startDate: at("2026-11-16"),
      endDate: at("2026-12-05"),
      settingDeadline: daysFromNow(12),
      moderationDeadline: daysFromNow(20),
      scrutinyDeadline: daysFromNow(27),
      approvalDeadline: daysFromNow(33),
      description: "Regular end-semester theory examinations for odd semesters (I, III, V) under R2023.",
      programs: { connect: Object.values(prog).map((id) => ({ id })) },
    },
  });
  await db.examinationSession.create({
    data: {
      name: "December 2026 Supplementary Examinations",
      code: "DEC2026S",
      academicYearId: ay2627.id,
      termType: "ODD",
      examType: "SUPPLEMENTARY",
      status: "PLANNING",
      startDate: at("2026-12-14"),
      endDate: at("2026-12-19"),
      programs: { connect: [{ id: prog.BCA }, { id: prog.BCOM }] },
    },
  });

  const blueprints: Record<string, Awaited<ReturnType<typeof makeBlueprint>>> = {};
  const exams: Record<string, string> = {};
  const moderatorFor = (d: string) => (d === "COM" ? users.moderator2.id : d === "CS" ? users.moderator.id : null);
  let slotDay = 0;
  for (const [code, , d, , s] of courseRows) {
    if (s % 2 === 0) continue;
    const c = courses[code];
    const practical = code.endsWith("P");
    const bp = practical ? null : await makeBlueprint(`${code} — End semester blueprint`, c.id, false);
    if (bp) blueprints[code] = bp;
    const examDate = new Date(Date.UTC(2026, 10, 16 + Math.floor(slotDay / 2) + Math.floor(slotDay / 10) * 2));
    const fn = slotDay % 2 === 0;
    slotDay++;
    const exam = await db.examination.create({
      data: {
        sessionId: nov.id,
        courseId: c.id,
        blueprintId: bp?.id,
        templateId: template.id,
        maxMarks: 75,
        durationMinutes: 180,
        moderatorId: moderatorFor(d),
        scrutinizerId: users.scrutiny.id,
        schedule: {
          create: {
            date: examDate,
            slot: fn ? "FN" : "AN",
            startsAt: new Date(examDate.getTime() + (fn ? 4.5 : 9) * 3_600_000),
            endsAt: new Date(examDate.getTime() + (fn ? 7.5 : 12) * 3_600_000),
            venue: "Examination Hall Block A",
          },
        },
      },
    });
    exams[code] = exam.id;
  }

  // ── Paper helpers ─────────────────────────────────────────
  const spec = (bp: (typeof blueprints)[string]): BlueprintSpec => ({
    totalMarks: bp.totalMarks,
    durationMinutes: bp.durationMinutes,
    sections: bp.sections.map((s) => ({ ...s, questionTypes: s.questionTypes })),
    rules: bp.rules,
  });
  async function candidatesFor(courseCode: string, recentlyUsed: Set<string>): Promise<Candidate[]> {
    const qs = await db.question.findMany({
      where: { courseId: courses[courseCode].id, status: "ACTIVE" },
      include: { unit: true, outcome: true, topic: true },
    });
    return qs.map((q) => ({
      id: q.id,
      code: q.code,
      text: q.plainText,
      marks: q.marks,
      type: q.type,
      difficulty: q.difficulty,
      bloom: q.bloom,
      unitNumber: q.unit.number,
      outcomeCode: q.outcome?.code ?? null,
      topic: q.topic?.title ?? null,
      usageCount: q.usageCount,
      recentlyUsed: recentlyUsed.has(q.id),
    }));
  }

  let paperSeq = 0;
  async function buildPaper(opts: {
    courseCode: string;
    examinationId: string;
    sessionCode: string;
    setterId: string;
    assignmentId?: string;
    bp: (typeof blueprints)[string];
    fill: number; // 0..1 fraction of each section to fill
    seed: number;
    recentlyUsed?: Set<string>;
  }) {
    paperSeq++;
    const paper = await db.questionPaper.create({
      data: {
        code: `${opts.courseCode}-${opts.sessionCode}-A`,
        examinationId: opts.examinationId,
        assignmentId: opts.assignmentId,
        setterId: opts.setterId,
        blueprintId: opts.bp.id,
        setLabel: "A",
        title: `${opts.courseCode} — End Semester Examination`,
        instructions: "Answer the questions as directed in each section. Draw diagrams wherever necessary.",
        createdAt: daysFromNow(-20 + paperSeq),
      },
    });
    const pool = await candidatesFor(opts.courseCode, opts.recentlyUsed ?? new Set());
    const gen = generatePaper(spec(opts.bp), pool, { seed: opts.seed });
    const poolById = new Map(pool.map((c) => [c.id, c]));
    for (const s of opts.bp.sections) {
      const section = await db.questionPaperSection.create({
        data: {
          paperId: paper.id,
          order: s.order,
          label: s.label,
          title: s.title,
          instructions: s.instructions,
          attemptCount: s.attemptCount,
          marksPerQuestion: s.marksPerQuestion,
        },
      });
      const ids = gen.sections[s.label] ?? [];
      const take = Math.round(ids.length * opts.fill);
      for (let i = 0; i < take; i++) {
        const q = await db.question.findUniqueOrThrow({ where: { id: ids[i] }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
        await db.questionPaperItem.create({
          data: { sectionId: section.id, order: i, questionId: q.id, questionVersionId: q.versions[0].id, marks: poolById.get(q.id)!.marks },
        });
      }
    }
    return paper;
  }

  async function snapshotVersion(paperId: string, major: number, minor: number, label: string, status: PaperStatus, reason: string, actorId: string, createdAt: Date, isFinal = false) {
    const full = await db.questionPaper.findUniqueOrThrow({ where: { id: paperId }, include: PAPER_CONTENT_INCLUDE });
    const snap = buildSnapshot(full, inst);
    const contentHash = sha256(canonicalJson(snap));
    await db.questionPaperVersion.create({
      data: { paperId, major, minor, label, status, snapshot: snap as unknown as Prisma.InputJsonValue, contentHash, reason, createdById: actorId, isFinal, createdAt },
    });
    return contentHash;
  }

  async function transition(paperId: string, from: PaperStatus, to: PaperStatus, action: string, actor: { id: string; name: string }, when: Date, note?: string) {
    await db.paperTransition.create({ data: { paperId, from, to, action, actorId: actor.id, note, createdAt: when } });
    await db.questionPaper.update({ where: { id: paperId }, data: { status: to } });
    await auditLog({ actorId: actor.id, actorName: actor.name, action: `paper.${action}`, resourceType: "paper", resourceId: paperId, summary: `${from} → ${to}${note ? `: ${note}` : ""}`, newValue: { status: to }, createdAt: when });
  }

  async function recordUsage(paperId: string, examinationId: string, sessionId: string, sessionCode: string, when: Date) {
    const items = await db.questionPaperItem.findMany({ where: { section: { paperId } } });
    for (const it of items) {
      await db.questionUsage.create({ data: { questionId: it.questionId, questionVersionId: it.questionVersionId, paperId, examinationId, sessionId, usedAt: when } });
      await db.question.update({ where: { id: it.questionId }, data: { usageCount: { increment: 1 }, lastUsedAt: when, lastUsedSessionId: sessionCode } });
    }
  }

  // ── April 2026 history: locked & archived papers (usage history) ──
  console.log("› historical papers (April 2026)");
  const recentlyUsed: Record<string, Set<string>> = {};
  for (const [i, code] of ["BCS301", "BCS302"].entries()) {
    const c = courses[code];
    const bp = blueprints[code];
    const exam = await db.examination.create({
      data: { sessionId: apr.id, courseId: c.id, blueprintId: bp.id, templateId: template.id, maxMarks: 75, durationMinutes: 180, isLocked: true, moderatorId: users.moderator.id, scrutinizerId: users.scrutiny.id },
    });
    const setter = i === 0 ? users.setter : users.setter2;
    const paper = await buildPaper({ courseCode: code, examinationId: exam.id, sessionCode: "APR2026", setterId: setter.id, bp, fill: 1, seed: 1000 + i });
    const t0 = at("2026-02-15T10:00:00Z");
    await snapshotVersion(paper.id, 1, 0, "1.0", "SUBMITTED", "Submitted by setter", setter.id, t0);
    await transition(paper.id, "DRAFT", "SUBMITTED", "submit", setter, t0);
    await transition(paper.id, "SUBMITTED", "UNDER_MODERATION", "start_moderation", users.moderator, new Date(t0.getTime() + 2 * day));
    await transition(paper.id, "UNDER_MODERATION", "UNDER_SCRUTINY", "moderation_approve", users.moderator, new Date(t0.getTime() + 5 * day));
    await transition(paper.id, "UNDER_SCRUTINY", "AWAITING_APPROVAL", "scrutiny_pass", users.scrutiny, new Date(t0.getTime() + 8 * day));
    await transition(paper.id, "AWAITING_APPROVAL", "APPROVED", "approve", users.approver, new Date(t0.getTime() + 11 * day));
    const lockedAt = new Date(t0.getTime() + 11 * day + 3_600_000);
    const finalHash = await snapshotVersion(paper.id, 2, 0, "2.0 FINAL", "LOCKED", "Locked after approval", users.controller.id, lockedAt, true);
    await transition(paper.id, "APPROVED", "LOCKED", "lock", users.controller, lockedAt);
    await transition(paper.id, "LOCKED", "RELEASED", "release", users.controller, at("2026-04-01T09:00:00Z"));
    await transition(paper.id, "RELEASED", "ARCHIVED", "archive", users.controller, at("2026-05-10T09:00:00Z"));
    await db.questionPaper.update({
      where: { id: paper.id },
      data: { versionMajor: 2, versionMinor: 0, submittedAt: t0, approvedAt: new Date(t0.getTime() + 11 * day), lockedAt, lockedById: users.controller.id, releasedAt: at("2026-04-01T09:00:00Z"), archivedAt: at("2026-05-10T09:00:00Z"), finalHash },
    });
    await db.moderation.create({ data: { paperId: paper.id, moderatorId: users.moderator.id, status: "APPROVED", round: 1, summary: "Well balanced paper. Approved.", versionLabel: "1.0", startedAt: new Date(t0.getTime() + 2 * day), completedAt: new Date(t0.getTime() + 5 * day) } });
    await db.scrutiny.create({ data: { paperId: paper.id, officerId: users.scrutiny.id, status: "PASSED", remarks: "All checks passed.", versionLabel: "1.0", completedAt: new Date(t0.getTime() + 8 * day) } });
    await db.approval.create({ data: { paperId: paper.id, approverId: users.approver.id, decision: "APPROVED", versionLabel: "1.0", remarks: "Approved for printing.", createdAt: new Date(t0.getTime() + 11 * day) } });
    await recordUsage(paper.id, exam.id, apr.id, "APR2026", at("2026-04-10T04:30:00Z"));
    const used = await db.questionUsage.findMany({ where: { paperId: paper.id }, select: { questionId: true } });
    recentlyUsed[code] = new Set(used.map((u) => u.questionId));
  }

  // ── November 2026: assignments and papers across the workflow ──
  console.log("› November 2026 workflow");
  const assign = (code: string, setter: string, status: Prisma.SetterAssignmentCreateInput["status"], deadlineDays: number, backup?: string) =>
    db.setterAssignment.create({
      data: {
        examinationId: exams[code],
        setterId: users[setter].id,
        backupSetterId: backup ? users[backup].id : null,
        assignedById: users.controller.id,
        blueprintId: blueprints[code]?.id,
        setLabel: "A",
        deadline: daysFromNow(deadlineDays),
        instructions: "Set the paper strictly as per the LOCF blueprint. Cover all five units; avoid questions used in the last two sessions.",
        status,
        respondedAt: status === "ASSIGNED" ? null : daysFromNow(-12),
        createdAt: daysFromNow(-15),
      },
    });

  // 1. BCS301 — Draft in progress (Dr. Farah Siddiqui)
  const aDS = await assign("BCS301", "setter", "IN_PROGRESS", 12, "setter2");
  await buildPaper({ courseCode: "BCS301", examinationId: exams.BCS301, sessionCode: "NOV2026", setterId: users.setter.id, assignmentId: aDS.id, bp: blueprints.BCS301, fill: 0.6, seed: 7, recentlyUsed: recentlyUsed.BCS301 });

  // 2. BCS303 — Submitted, awaiting moderation (Prof. Vikram Nair)
  const aOS = await assign("BCS303", "setter2", "SUBMITTED", 5);
  const pOS = await buildPaper({ courseCode: "BCS303", examinationId: exams.BCS303, sessionCode: "NOV2026", setterId: users.setter2.id, assignmentId: aOS.id, bp: blueprints.BCS303, fill: 1, seed: 11 });
  const tOS = daysFromNow(-2);
  await snapshotVersion(pOS.id, 1, 0, "1.0", "SUBMITTED", "Submitted by setter", users.setter2.id, tOS);
  await transition(pOS.id, "DRAFT", "SUBMITTED", "submit", users.setter2, tOS);
  await db.questionPaper.update({ where: { id: pOS.id }, data: { versionMajor: 1, versionMinor: 0, submittedAt: tOS } });
  await db.moderation.create({ data: { paperId: pOS.id, moderatorId: users.moderator.id, status: "PENDING", round: 1 } });
  await db.setterAssignment.update({ where: { id: aOS.id }, data: { submittedAt: tOS } });

  // 3. BCM301 — Moderated, under scrutiny (Dr. Deepa Thomas)
  const aCA = await assign("BCM301", "setter3", "SUBMITTED", 3);
  const pCA = await buildPaper({ courseCode: "BCM301", examinationId: exams.BCM301, sessionCode: "NOV2026", setterId: users.setter3.id, assignmentId: aCA.id, bp: blueprints.BCM301, fill: 1, seed: 5 });
  const tCA = daysFromNow(-9);
  await snapshotVersion(pCA.id, 1, 0, "1.0", "SUBMITTED", "Submitted by setter", users.setter3.id, tCA);
  await transition(pCA.id, "DRAFT", "SUBMITTED", "submit", users.setter3, tCA);
  await transition(pCA.id, "SUBMITTED", "UNDER_MODERATION", "start_moderation", users.moderator2, daysFromNow(-7));
  await transition(pCA.id, "UNDER_MODERATION", "REVISION_REQUIRED", "moderation_request_changes", users.moderator2, daysFromNow(-6), "Q14: specify the date of forfeiture; Section C numerical data is incomplete.");
  await snapshotVersion(pCA.id, 1, 1, "1.1", "RESUBMITTED", "Resubmitted after moderation comments", users.setter3.id, daysFromNow(-4));
  await transition(pCA.id, "REVISION_REQUIRED", "RESUBMITTED", "resubmit", users.setter3, daysFromNow(-4));
  await transition(pCA.id, "RESUBMITTED", "UNDER_MODERATION", "start_moderation", users.moderator2, daysFromNow(-3));
  await snapshotVersion(pCA.id, 1, 2, "1.2", "UNDER_SCRUTINY", "Moderation approved", users.moderator2.id, daysFromNow(-2));
  await transition(pCA.id, "UNDER_MODERATION", "UNDER_SCRUTINY", "moderation_approve", users.moderator2, daysFromNow(-2));
  await db.questionPaper.update({ where: { id: pCA.id }, data: { versionMajor: 1, versionMinor: 2, submittedAt: tCA, revisionCount: 1 } });
  const m1 = await db.moderation.create({ data: { paperId: pCA.id, moderatorId: users.moderator2.id, round: 1, status: "CHANGES_REQUESTED", summary: "Minor corrections required before scrutiny.", versionLabel: "1.0", startedAt: daysFromNow(-7), completedAt: daysFromNow(-6) } });
  await db.moderationComment.create({ data: { moderationId: m1.id, paperId: pCA.id, authorId: users.moderator2.id, kind: "ISSUE", body: "Specify the date of forfeiture and reissue in the forfeiture problem.", resolved: true } });
  await db.moderation.create({ data: { paperId: pCA.id, moderatorId: users.moderator2.id, round: 2, status: "APPROVED", summary: "Corrections verified. Syllabus coverage and difficulty balance are appropriate.", versionLabel: "1.1", startedAt: daysFromNow(-3), completedAt: daysFromNow(-2) } });
  await db.scrutiny.create({ data: { paperId: pCA.id, officerId: users.scrutiny.id, status: "PENDING" } });

  // 4. BCS302 — Awaiting final approval (Dr. Sanjay Iyer as setter)
  const aDB = await assign("BCS302", "hod.cs", "SUBMITTED", 2);
  const pDB = await buildPaper({ courseCode: "BCS302", examinationId: exams.BCS302, sessionCode: "NOV2026", setterId: users["hod.cs"].id, assignmentId: aDB.id, bp: blueprints.BCS302, fill: 1, seed: 21, recentlyUsed: recentlyUsed.BCS302 });
  const tDB = daysFromNow(-10);
  await snapshotVersion(pDB.id, 1, 0, "1.0", "SUBMITTED", "Submitted by setter", users["hod.cs"].id, tDB);
  await transition(pDB.id, "DRAFT", "SUBMITTED", "submit", users["hod.cs"], tDB);
  await transition(pDB.id, "SUBMITTED", "UNDER_MODERATION", "start_moderation", users.moderator, daysFromNow(-8));
  await snapshotVersion(pDB.id, 1, 1, "1.1", "UNDER_SCRUTINY", "Moderation approved", users.moderator.id, daysFromNow(-6));
  await transition(pDB.id, "UNDER_MODERATION", "UNDER_SCRUTINY", "moderation_approve", users.moderator, daysFromNow(-6));
  await transition(pDB.id, "UNDER_SCRUTINY", "AWAITING_APPROVAL", "scrutiny_pass", users.scrutiny, daysFromNow(-3));
  await db.questionPaper.update({ where: { id: pDB.id }, data: { versionMajor: 1, versionMinor: 1, submittedAt: tDB } });
  await db.moderation.create({ data: { paperId: pDB.id, moderatorId: users.moderator.id, round: 1, status: "APPROVED", summary: "Good coverage of all units; Bloom distribution appropriate.", versionLabel: "1.0", startedAt: daysFromNow(-8), completedAt: daysFromNow(-6) } });
  await db.scrutiny.create({ data: { paperId: pDB.id, officerId: users.scrutiny.id, status: "PASSED", remarks: "Formatting, numbering and marks verified.", versionLabel: "1.1", completedAt: daysFromNow(-3) } });

  // 5. Other assignments at various stages
  await assign("BCS501", "setter2", "ASSIGNED", 14);
  await assign("BBA301", "setter7", "ACCEPTED", 10);
  await assign("BMA301", "setter5", "ASSIGNED", -3); // overdue
  await assign("BCM302", "setter4", "IN_PROGRESS", 1);
  await assign("BCS304", "setter", "ASSIGNED", 16);
  await db.setterRecommendation.create({ data: { examinationId: exams.BCS502, departmentId: dept.CS, setterId: users.setter2.id, recommenderId: users["hod.cs"].id, note: "Has taught Software Engineering for six years." } });

  // ── Notifications & audit ──────────────────────────────────
  console.log("› notifications & audit");
  const n = (handle: string, type: string, title: string, body: string, link: string, ago: number, read = false) =>
    db.notification.create({ data: { userId: users[handle].id, type, title, body, link, createdAt: new Date(NOW.getTime() - ago * 60_000), readAt: read ? NOW : null } });
  await n("controller", "paper.submitted", "Paper BCS303 submitted", "Operating Systems — submitted by Prof. Vikram Nair", `/papers/${pOS.id}`, 2 * 24 * 60);
  await n("controller", "approval.requested", "Approval requested: BCS302", "Database Management Systems has passed scrutiny.", `/approvals/${pDB.id}`, 3 * 24 * 60);
  await n("controller", "deadline.overdue", "Assignment overdue: BMA301", "Real Analysis I — Dr. Nisha Varma has not accepted the assignment.", "/setters", 60);
  await n("approver", "approval.requested", "Approval requested: BCS302", "Database Management Systems is ready for final approval.", `/approvals/${pDB.id}`, 3 * 24 * 60);
  await n("moderator", "moderation.required", "Moderation required: BCS303", "Operating Systems is waiting for your review.", `/moderation/${pOS.id}`, 2 * 24 * 60);
  await n("scrutiny", "scrutiny.required", "Scrutiny required: BCM301", "Corporate Accounting has been approved by the moderator.", `/scrutiny/${pCA.id}`, 2 * 24 * 60);
  await n("setter", "assignment.received", "New assignment: BCS304", "Object Oriented Programming with Java — due in 16 days.", "/assignments", 30);
  await n("setter", "deadline.approaching", "Deadline in 12 days: BCS301", "Data Structures paper submission.", "/assignments", 24 * 60, true);
  await n("setter5", "deadline.overdue", "Assignment overdue: BMA301", "Please accept and submit the Real Analysis I paper.", "/assignments", 120);

  for (const [handle, ago] of [["controller", 50], ["setter", 40], ["moderator", 30], ["admin", 20]] as const) {
    await auditLog({ actorId: users[handle].id, actorName: users[handle].name, action: "auth.login", resourceType: "user", resourceId: users[handle].id, summary: "Signed in (password)", createdAt: new Date(NOW.getTime() - ago * 60_000) });
  }
  await auditLog({ actorName: null, action: "auth.login.failed", resourceType: "auth", summary: "Unknown identifier", newValue: { identifier: "registry-office@example.edu" }, createdAt: new Date(NOW.getTime() - 15 * 60_000) });
  await seedErp({
    db,
    passwordHash,
    institutionId: inst.id,
    dept,
    prog,
    sem,
    roleId,
    users,
    courses,
    academicYears: { previous: ay2526.id, current: ay2627.id },
    regulationId: r23.id,
    now: NOW,
    auditLog,
  });

  await auditLog({ actorId: users.admin.id, actorName: users.admin.name, action: "system.seed", resourceType: "system", summary: "Demo dataset loaded", createdAt: new Date() });

  const qCount = await db.question.count();
  console.log(`✓ Seed complete — ${qCount} questions, ${Object.keys(users).length} users. Demo password: ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
