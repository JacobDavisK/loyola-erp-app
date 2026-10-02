/**
 * Regulatory demo data: NEP exit awards, programme outcomes with CO–PO matrices and assessment mappings,
 * APAAR IDs (some verified), credit transfers, privacy notices with everyone's acknowledgement on record,
 * a data-principal request, a closed breach, retention rules, and NAAC 2025 / NIRF frameworks whose
 * metrics are computed from the system's own records.
 */
import type { SeedContext } from "./seed-erp";

export async function seedCompliance(s: SeedContext, r: () => number) {
  const { db } = s;
  console.log("› regulatory: NEP exits, outcomes, APAAR, credit transfer, privacy, NAAC 2025 / NIRF");
  const day = 86_400_000;
  const now = s.now.getTime();

  await db.systemSetting.upsert({ where: { key: "nep" }, create: { key: "nep", value: { externalCreditMaxPercent: 40, nadIssuerName: "University of the World" } }, update: { value: { externalCreditMaxPercent: 40, nadIssuerName: "University of the World" } } });

  // ── NEP multiple exit ──
  const awards: Record<string, [number, string, number, number][]> = {
    BCA: [[1, "UG Certificate in Computer Applications", 40, 1], [2, "UG Diploma in Computer Applications", 80, 2], [3, "Bachelor of Computer Applications", 120, 3]],
    BCOM: [[1, "UG Certificate in Commerce", 40, 1], [2, "UG Diploma in Commerce", 80, 2], [3, "Bachelor of Commerce", 120, 3]],
  };
  for (const [code, list] of Object.entries(awards)) {
    for (const [level, title, minCredits, minYears] of list) await db.programExitAward.create({ data: { programId: s.prog[code], level, title, minCredits, minYears, reentryYears: 7 } });
  }

  // ── Programme outcomes and CO–PO matrices ──
  const outcomeSets: Record<string, [string, string, string][]> = {
    BCA: [
      ["PO1", "Computational knowledge", "Apply knowledge of computing fundamentals, mathematics and domain knowledge to solve problems."],
      ["PO2", "Problem analysis", "Identify, formulate and analyse computing problems and reach substantiated conclusions."],
      ["PO3", "Design and development", "Design, implement and evaluate software systems that meet specified needs."],
      ["PO4", "Modern tool usage", "Select and use appropriate techniques, resources and modern IT tools."],
      ["PO5", "Ethics and communication", "Apply professional ethics and communicate effectively with diverse audiences."],
      ["PO6", "Life-long learning", "Recognise the need for, and engage in, independent and life-long learning."],
      ["PSO1", "Programming proficiency", "Develop correct, maintainable programs in at least two programming paradigms."],
      ["PSO2", "Data management", "Design and query databases and data structures for real applications."],
    ],
    BCOM: [
      ["PO1", "Commerce knowledge", "Apply principles of accounting, finance, economics and business law."],
      ["PO2", "Analytical reasoning", "Analyse financial statements and business data to support decisions."],
      ["PO3", "Professional skills", "Use accounting software and digital tools in business practice."],
      ["PO4", "Ethics and social responsibility", "Act ethically and understand the social responsibilities of business."],
      ["PO5", "Communication", "Communicate business information clearly in writing and speech."],
    ],
  };
  const poIds: Record<string, string[]> = {};
  for (const [code, list] of Object.entries(outcomeSets)) {
    poIds[code] = [];
    for (const [i, [c, title, description]] of list.entries()) {
      const po = await db.programOutcome.create({ data: { programId: s.prog[code], code: c, kind: c.startsWith("PSO") ? "PSO" : "PO", title, description, order: c.startsWith("PSO") ? 100 + i : i } });
      poIds[code].push(po.id);
    }
  }
  const courses = await db.course.findMany({ where: { programId: { in: [s.prog.BCA, s.prog.BCOM] } }, select: { id: true, programId: true, outcomes: { select: { id: true }, orderBy: { code: "asc" } } } });
  for (const c of courses) {
    const pos = c.programId === s.prog.BCA ? poIds.BCA : poIds.BCOM;
    for (const [i, co] of c.outcomes.entries()) {
      // Each CO correlates strongly with one PO, moderately with another and weakly with a third.
      const picks = [pos[i % pos.length], pos[(i + 2) % pos.length], pos[(i + 4) % pos.length]];
      const strengths = [3, 2, 1];
      await db.coPoMapping.createMany({ data: [...new Set(picks)].map((po, k) => ({ outcomeId: co.id, programOutcomeId: po, strength: strengths[k] })), skipDuplicates: true });
    }
  }

  // Assessment components → COs, for every class that has components (internal tests split the COs; the exam covers all).
  const comps = await db.assessmentComponent.findMany({ include: { offering: { select: { course: { select: { outcomes: { select: { id: true }, orderBy: { code: "asc" } } } } } } } });
  for (const comp of comps) {
    const cos = comp.offering.course.outcomes.map((o) => o.id);
    if (!cos.length) continue;
    const ids = comp.kind === "EXTERNAL" ? cos : /2|II/.test(comp.name) ? cos.slice(Math.ceil(cos.length / 2)) : comp.kind === "INTERNAL" ? cos.slice(0, Math.ceil(cos.length / 2)) : cos.filter((_, i) => i % 2 === 0);
    await db.componentOutcome.createMany({ data: ids.map((outcomeId) => ({ componentId: comp.id, outcomeId })), skipDuplicates: true });
  }

  // ── APAAR IDs ──
  const students = await db.student.findMany({ where: { deletedAt: null }, orderBy: { studentNo: "asc" }, select: { id: true } });
  let n = 0;
  for (const st of students) {
    n++;
    if (n % 10 >= 7) continue; // 30% have not given their APAAR ID yet
    const apaarId = String(100000000000 + Math.floor(r() * 899999999999)).slice(0, 12);
    const verified = n % 10 < 5;
    await db.student.update({ where: { id: st.id }, data: { apaarId, apaarVerifiedAt: verified ? new Date(now - 20 * day) : null, apaarVerifiedById: verified ? s.users.registrar.id : null } }).catch(() => undefined);
  }

  // ── Credit transfer ──
  const bcaStudents = await db.student.findMany({ where: { programId: s.prog.BCA, status: "ACTIVE" }, orderBy: { studentNo: "asc" }, take: 3, select: { id: true } });
  if (bcaStudents.length === 3) {
    await db.externalCredit.create({ data: { studentId: bcaStudents[0].id, source: "SWAYAM", provider: "SWAYAM (IIT Madras)", courseTitle: "Programming, Data Structures and Algorithms using Python", courseCode: "noc26-cs40", credits: 3, grade: "Elite", completedOn: new Date(now - 40 * day), certificateNo: "NPTEL26CS40S1234" } });
    await db.externalCredit.create({ data: { studentId: bcaStudents[1].id, source: "NPTEL", provider: "NPTEL (IIT Kharagpur)", courseTitle: "Introduction to Machine Learning", credits: 3, grade: "Elite + Silver", completedOn: new Date(now - 120 * day), status: "APPROVED", reviewedById: s.users["hod.cs"].id, reviewedAt: new Date(now - 100 * day), remarks: "Accepted as an open elective." } });
    await db.externalCredit.create({ data: { studentId: bcaStudents[2].id, source: "MOOC", provider: "Coursera", courseTitle: "Social Media Marketing", credits: 2, completedOn: new Date(now - 60 * day), status: "REJECTED", reviewedById: s.users["hod.cs"].id, reviewedAt: new Date(now - 50 * day), remarks: "Not on the approved MOOC list for this programme." } });
  }

  // ── Privacy notices, with acknowledgements on record ──
  const notice = (key: string, title: string, purpose: string, audience: "ALL" | "STUDENT" | "STAFF" | "GUARDIAN", required: boolean, body: string) =>
    db.consentNotice.create({ data: { key, version: 1, title, purpose, audience, required, body, createdById: s.users.dpo.id, createdAt: new Date(now - 200 * day) } });
  const contact = "Contact the Data Protection Officer at dpo@example.edu or through Privacy & consent → Make a request.";
  const studentNotice = await notice("student.records", "How we use your student records", "Running your studies: admission, teaching, examinations, results, fees and certificates.", "STUDENT", true,
    `**What we collect.** Identity and contact details, guardians, academic records (registrations, attendance, marks, results), fees and payments, documents you submit, and sign-in activity.\n\n**Why.** To admit you, teach and assess you, issue results and certificates, collect fees, keep the campus safe, and meet our duties to the UGC, the university and the Academic Bank of Credits.\n\n**How long.** Academic results and certificates are kept permanently; other records for as long as the law and our policies require.\n\n**Your rights.** You can see, correct and (where the law allows) erase your data, nominate someone to act for you, and complain to us and then to the Data Protection Board of India. ${contact}`);
  const staffNotice = await notice("staff.records", "How we use your employment records", "Employment: HR, payroll, leave, appraisal and statutory returns.", "STAFF", true,
    `**What we collect.** Identity and contact details, qualifications, employment history, bank and tax identifiers (stored encrypted), attendance, leave, salary and appraisal records.\n\n**Why.** To employ and pay you, meet tax and provident-fund obligations, and report to regulators (AISHE, NIRF, NAAC).\n\n**Your rights.** ${contact}`);
  const guardianNotice = await notice("guardian.records", "How we use guardians' details", "Contacting you about your ward and giving you access to their records.", "GUARDIAN", true,
    `We keep your name and contact details to reach you about your ward and, where the institution allows, to show you their attendance, results and fees. ${contact}`);
  await notice("directory.listing", "Alumni and student directory", "Listing your name, programme and employer in the directory other members can see.", "ALL", false, `Only if you allow it. You can withdraw at any time. ${contact}`);
  await notice("publicity.photos", "Photographs in publicity", "Using photographs of you taken at institutional events on the website and social media.", "ALL", false, `Only if you allow it. Withdrawing stops future use. ${contact}`);
  await notice("ai.assistant", "AI assistant", "Letting the AI assistant read your own records to answer your questions.", "ALL", false, `When allowed, the assistant reads only your own records for the question you ask. Nothing is used to train AI models. ${contact}`);
  const users = await db.user.findMany({ select: { id: true, userType: true } });
  const ack = users.map((u) => ({ userId: u.id, noticeId: u.userType === "STUDENT" ? studentNotice.id : u.userType === "GUARDIAN" ? guardianNotice.id : staffNotice.id, decision: "GRANTED" as const, createdAt: new Date(now - 150 * day) }));
  await db.consentRecord.createMany({ data: ack });

  // A data-principal request and a closed breach.
  const someStudent = await db.student.findFirst({ where: { userId: { not: null }, status: "ACTIVE" }, orderBy: { studentNo: "asc" }, select: { userId: true } });
  if (someStudent?.userId) {
    await db.dataRequest.create({ data: { number: "DPR/2026/00001", userId: someStudent.userId, type: "CORRECTION", details: "My mother's name is misspelt in the guardian details; it should be 'Lakshmi', not 'Laxmi'.", dueAt: new Date(now + 26 * day), createdAt: new Date(now - 4 * day) } });
    await db.numberSequence.upsert({ where: { key: "privacy.request" }, create: { key: "privacy.request", prefix: "DPR/{YYYY}/", padding: 5, next: 2 }, update: {} }).catch(() => undefined);
  }
  await db.breachIncident.create({
    data: {
      number: "BR/2026/0001", title: "Internal marks spreadsheet e-mailed to the wrong class group", description: "A teacher attached the CS internal-marks sheet to an e-mail to the BCOM class group. The message was recalled within 20 minutes.",
      detectedAt: new Date(now - 90 * day), severity: "MEDIUM", dataCategories: "Names, student numbers, internal marks", affectedCount: 58, status: "CLOSED",
      containment: "Message recalled; recipients asked to delete; marks are now shared only through the portal.", boardNotifiedAt: new Date(now - 89 * day), usersNotifiedAt: new Date(now - 89 * day), closedAt: new Date(now - 60 * day), reportedById: s.users["hod.cs"].id,
    },
  });
  await db.numberSequence.upsert({ where: { key: "privacy.breach" }, create: { key: "privacy.breach", prefix: "BR/{YYYY}/", padding: 4, next: 2 }, update: { next: 2 } });
  await db.retentionRule.createMany({ data: [{ dataset: "login_attempts", retainDays: 180 }, { dataset: "ended_sessions", retainDays: 90 }, { dataset: "password_reset_tokens", retainDays: 30 }, { dataset: "read_notifications", retainDays: 365 }] });

  // ── NAAC 2025 (binary + maturity levels) and NIRF, drawing on computed sources ──
  const framework = async (code: string, name: string, description: string, outline: [string, string, "QUANTITATIVE" | "QUALITATIVE", number, string | null, string | null][]) => {
    const fw = await db.accreditationFramework.create({ data: { code, name, description } });
    const ids = new Map<string, string>();
    for (const [i, [c, title, kind, weight, source, unit]] of outline.entries()) {
      const parent = c.includes(".") ? ids.get(c.split(".")[0]) ?? null : null;
      ids.set(c, (await db.accreditationMetric.create({ data: { frameworkId: fw.id, code: c, title, kind, weight, source, unit, parentId: parent, order: i } })).id);
    }
    return fw;
  };
  await framework("NAAC-2025", "NAAC Binary Accreditation & Maturity-Based Graded Levels (2025)", "Data points for the binary decision (Accredited / Not accredited) and maturity levels 1–5. Each value is validated digitally against institutional records, so claims are drawn from the system wherever possible.", [
    ["1", "Curriculum and outcomes", "QUALITATIVE", 100, null, null],
    ["1.1", "Classes whose assessments are mapped to course outcomes", "QUANTITATIVE", 20, "obe.mappedClasses", "%"],
    ["1.2", "Outcome-based curriculum with CO–PO attainment analysed", "QUALITATIVE", 30, null, null],
    ["2", "Teaching, learning and evaluation", "QUALITATIVE", 150, null, null],
    ["2.1", "Student – full-time teacher ratio", "QUANTITATIVE", 20, "ratio.studentTeacher", "ratio"],
    ["2.2", "Teachers with a PhD", "QUANTITATIVE", 20, "faculty.phdPercent", "%"],
    ["2.3", "ICT-enabled teaching (classes using the learning platform)", "QUANTITATIVE", 15, "lms.adoption", "%"],
    ["2.4", "Pass percentage", "QUANTITATIVE", 20, "results.passPercent", "%"],
    ["3", "Research and innovation", "QUALITATIVE", 120, null, null],
    ["3.1", "Indexed publications", "QUANTITATIVE", 20, "publications.indexed", "publications"],
    ["3.2", "Research grants sanctioned", "QUANTITATIVE", 20, "research.grants", "₹"],
    ["4", "Student support, progression and NEP readiness", "QUALITATIVE", 100, null, null],
    ["4.1", "Students with a verified APAAR / ABC ID", "QUANTITATIVE", 15, "apaar.coverage", "%"],
    ["4.2", "Students placed", "QUANTITATIVE", 15, "placements.selected", "students"],
    ["4.3", "Scholarship beneficiaries", "QUANTITATIVE", 10, "scholarships.beneficiaries", "students"],
    ["5", "Governance and data integrity", "QUALITATIVE", 80, null, null],
    ["5.1", "Data protection and digital governance (DPDP compliance, audit trail)", "QUALITATIVE", 20, null, null],
  ]);
  await framework("NIRF", "NIRF data capture", "National Institutional Ranking Framework parameters: Teaching-Learning & Resources, Research & Professional Practice, Graduation Outcomes, Outreach & Inclusivity, Perception.", [
    ["TLR", "Teaching, learning and resources", "QUALITATIVE", 30, null, null],
    ["TLR.SS", "Student strength", "QUANTITATIVE", 5, "students.enrolled", "students"],
    ["TLR.FSR", "Faculty–student ratio", "QUANTITATIVE", 10, "ratio.studentTeacher", "ratio"],
    ["TLR.FQE", "Faculty with PhD", "QUANTITATIVE", 10, "faculty.phdPercent", "%"],
    ["RP", "Research and professional practice", "QUALITATIVE", 30, null, null],
    ["RP.PU", "Publications per faculty", "QUANTITATIVE", 10, "publications.perFaculty", "per teacher"],
    ["RP.FPPP", "Sponsored research (amount)", "QUANTITATIVE", 10, "research.grants", "₹"],
    ["GO", "Graduation outcomes", "QUALITATIVE", 20, null, null],
    ["GO.GUE", "Graduates in the year", "QUANTITATIVE", 8, "students.graduated", "students"],
    ["GO.GPH", "Students placed", "QUANTITATIVE", 6, "placements.selected", "students"],
    ["GO.MS", "Median salary", "QUANTITATIVE", 6, "placements.medianCtc", "₹"],
    ["OI", "Outreach and inclusivity", "QUALITATIVE", 10, null, null],
    ["OI.WD", "Women students", "QUANTITATIVE", 5, "students.femalePercent", "%"],
    ["PR", "Perception", "QUALITATIVE", 10, null, null],
  ]);
}
