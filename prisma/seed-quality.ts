/**
 * Research & IQAC demo data: sponsored projects at every stage (draft, cleared, running with spending,
 * completed), publications (some verified), and a NAAC-style framework with a current cycle whose metrics
 * are partly assigned, answered and approved.
 */
import type { SeedContext } from "./seed-erp";

export async function seedQuality(s: SeedContext, r: () => number) {
  const { db } = s;
  console.log("› research & IQAC: projects, publications, accreditation cycle");
  const d = (x: string) => new Date(`${x}T00:00:00Z`);
  const emp = async (handle: string) => db.employee.findFirstOrThrow({ where: { user: { email: `${handle}@example.edu` } } });
  const [hod, cs1, cs2, setter, com1, hodCom] = await Promise.all(["hod.cs", "faculty.cs1", "faculty.cs2", "setter", "faculty.com1", "hod.commerce"].map(emp));
  let seq = 0;
  const code = () => `RP/2026/${String(++seq).padStart(4, "0")}`;
  type Head = "EQUIPMENT" | "CONSUMABLES" | "TRAVEL" | "MANPOWER" | "CONTINGENCY" | "OVERHEAD";
  const project = async (o: { pi: typeof hod; co?: typeof hod[]; title: string; agency: string; scheme?: string; months: number; budget: [Head, number][]; status: "DRAFT" | "APPROVED" | "SANCTIONED" | "COMPLETED"; start?: string; grantRef?: string; outcome?: string }) => {
    const total = o.budget.reduce((a, [, x]) => a + x, 0);
    const start = o.start ? d(o.start) : null;
    return db.researchProject.create({
      data: {
        code: code(), title: o.title, abstract: `${o.title}. The project studies the problem, builds a prototype, evaluates it on real institutional data and publishes the results in peer-reviewed venues.`,
        departmentId: o.pi.departmentId, fundingAgency: o.agency, scheme: o.scheme ?? null, proposedAmount: total.toFixed(2), durationMonths: o.months, status: o.status, createdById: o.pi.userId!,
        sanctionedAmount: ["SANCTIONED", "COMPLETED"].includes(o.status) ? total.toFixed(2) : null, grantRef: o.grantRef ?? null, startDate: start,
        endDate: start ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + o.months, start.getUTCDate() - 1)) : null, outcome: o.outcome ?? null,
        members: { create: [{ employeeId: o.pi.id, role: "PI" as const }, ...(o.co ?? []).map((e) => ({ employeeId: e.id, role: "CO_PI" as const }))] },
        budget: { create: o.budget.map(([head, amount]) => ({ head, amount: amount.toFixed(2) })) },
      },
    });
  };
  const running = await project({ pi: hod, co: [cs1], title: "Privacy-preserving learning analytics for higher education", agency: "Science and Engineering Research Board (SERB)", scheme: "Core Research Grant", months: 36, status: "SANCTIONED", start: "2025-10-01", grantRef: "CRG/2025/004512", budget: [["EQUIPMENT", 1200000], ["CONSUMABLES", 150000], ["TRAVEL", 200000], ["MANPOWER", 1800000], ["CONTINGENCY", 100000], ["OVERHEAD", 345000]] });
  for (const [head, amount, date, desc] of [["EQUIPMENT", 685000, "2025-11-20", "GPU workstation (PO 118/2025)"], ["MANPOWER", 372000, "2026-03-31", "JRF stipend Oct 2025 – Mar 2026"], ["TRAVEL", 42500, "2026-01-15", "Conference travel, EDM 2026"], ["CONSUMABLES", 18400, "2026-02-10", "Storage media and cloud credits"], ["MANPOWER", 372000, "2026-09-15", "JRF stipend Apr – Sep 2026"]] as const) {
    await db.projectExpense.create({ data: { projectId: running.id, head, amount: amount.toFixed(2), date: d(date), voucherNo: `RV/${date.slice(0, 4)}/${Math.floor(100 + r() * 800)}`, description: desc, recordedById: hod.userId! } });
  }
  await project({ pi: setter, title: "Automatic generation of balanced question papers using Bloom's taxonomy", agency: "AICTE", scheme: "Research Promotion Scheme", months: 24, status: "COMPLETED", start: "2023-07-01", grantRef: "AICTE/RPS/2023/0917", budget: [["EQUIPMENT", 400000], ["CONSUMABLES", 60000], ["CONTINGENCY", 40000]], outcome: "Delivered a blueprint-driven paper generator now used by the examination cell; two journal papers and one conference paper." });
  await project({ pi: com1, co: [hodCom], title: "Digital payment adoption among micro-enterprises in the district", agency: "Indian Council of Social Science Research (ICSSR)", months: 18, status: "APPROVED", budget: [["TRAVEL", 150000], ["MANPOWER", 300000], ["CONTINGENCY", 50000]] });
  await project({ pi: cs1, title: "Energy-aware scheduling for edge devices", agency: "Department of Science and Technology (DST)", scheme: "SERB-SURE", months: 24, status: "DRAFT", budget: [["EQUIPMENT", 350000], ["CONSUMABLES", 50000], ["MANPOWER", 600000]] });
  await db.numberSequence.create({ data: { key: "research.project", prefix: "RP/{YYYY}/", next: seq + 1, padding: 4 } });

  const pubs: [typeof hod[], "JOURNAL" | "CONFERENCE" | "BOOK" | "CHAPTER" | "PATENT", string, string, number, "SCOPUS" | "WEB_OF_SCIENCE" | "UGC_CARE" | "NONE", boolean, string | null][] = [
    [[hod, cs1], "JOURNAL", "Differentially private early-warning models for student attrition", "IEEE Transactions on Learning Technologies", 2026, "WEB_OF_SCIENCE", true, "10.1109/TLT.2026.3301122"],
    [[hod], "CONFERENCE", "Federated learning analytics across affiliated colleges", "Proc. Educational Data Mining (EDM)", 2026, "SCOPUS", true, null],
    [[setter], "JOURNAL", "Blueprint-constrained question paper generation", "Computers & Education", 2024, "SCOPUS", true, "10.1016/j.compedu.2024.105011"],
    [[setter, cs2], "CONFERENCE", "Measuring cognitive balance in examination papers", "Proc. IEEE TALE", 2024, "SCOPUS", true, null],
    [[setter], "JOURNAL", "Similarity search for question banks at scale", "Journal of Educational Computing Research", 2025, "SCOPUS", true, "10.1177/07356331251234567"],
    [[cs1], "JOURNAL", "A survey of energy-aware task scheduling on edge devices", "Journal of Systems Architecture", 2025, "SCOPUS", false, "10.1016/j.sysarc.2025.103201"],
    [[cs2], "CHAPTER", "Teaching operating systems with containers", "Innovations in Computing Education (Springer)", 2025, "NONE", true, null],
    [[com1], "JOURNAL", "UPI adoption and working capital in micro-enterprises", "Indian Journal of Finance", 2025, "UGC_CARE", true, null],
    [[hodCom], "BOOK", "Financial Accounting for Undergraduates", "Himalaya Publishing House", 2023, "NONE", true, null],
    [[hod, setter], "PATENT", "System and method for tamper-evident examination paper packaging", "Indian Patent Office (published application)", 2025, "NONE", true, null],
    [[com1], "CONFERENCE", "Financial literacy and digital payments: evidence from field surveys", "International Conference on Business Research", 2026, "NONE", false, null],
  ];
  const verifier = s.users.research.id;
  for (const [authors, type, title, venue, year, indexing, verified, doi] of pubs) {
    await db.publication.create({
      data: {
        type, title, venue, year, indexing, doi: doi?.toLowerCase() ?? null, authorsText: authors.map((a) => `${a.firstName[0]}. ${a.lastName}`).join(", ") + (r() > 0.5 ? ", et al." : ""),
        departmentId: authors[0].departmentId, projectId: title.startsWith("Differentially") || title.startsWith("Federated") ? running.id : null, createdById: authors[0].userId!,
        verifiedAt: verified ? new Date(s.now.getTime() - 20 * 86_400_000) : null, verifiedById: verified ? verifier : null,
        authors: { create: authors.map((a, i) => ({ employeeId: a.id, position: i + 1 })) },
      },
    });
  }

  // NAAC-style framework (a representative subset of the quantitative and qualitative metrics).
  const fw = await db.accreditationFramework.create({ data: { code: "NAAC", name: "NAAC Assessment & Accreditation (revised framework)", description: "Representative subset of criteria and metrics for demonstration. Maintain the full manual under IQAC → Frameworks." } });
  const outline: [string, string, "QUANTITATIVE" | "QUALITATIVE", number, string | null, string | null][] = [
    ["1", "Curricular aspects", "QUALITATIVE", 100, null, null],
    ["1.1.1", "Curricula developed and implemented have relevance to local, national, regional and global developmental needs", "QUALITATIVE", 20, null, null],
    ["2", "Teaching-learning and evaluation", "QUALITATIVE", 200, null, null],
    ["2.2.1", "Student – full-time teacher ratio", "QUANTITATIVE", 10, "ratio.studentTeacher", "ratio"],
    ["2.4.1", "Full-time teachers (count)", "QUANTITATIVE", 10, "faculty.fulltime", "teachers"],
    ["2.4.2", "Percentage of full-time teachers with PhD", "QUANTITATIVE", 20, "faculty.phdPercent", "%"],
    ["2.6.3", "Pass percentage of students", "QUANTITATIVE", 20, "results.passPercent", "%"],
    ["3", "Research, innovations and extension", "QUALITATIVE", 110, null, null],
    ["3.1.1", "Grants received from government and non-government agencies for research projects", "QUANTITATIVE", 10, "research.grants", "₹"],
    ["3.1.2", "Number of research projects sanctioned", "QUANTITATIVE", 5, "research.projects", "projects"],
    ["3.3.1", "Number of research papers per teacher in UGC-CARE / indexed journals", "QUANTITATIVE", 10, "publications.perFaculty", "papers per teacher"],
    ["3.3.2", "Number of indexed publications", "QUANTITATIVE", 10, "publications.indexed", "publications"],
    ["5", "Student support and progression", "QUALITATIVE", 100, null, null],
    ["5.1.1", "Students benefited by scholarships and freeships", "QUANTITATIVE", 10, "scholarships.beneficiaries", "students"],
    ["7", "Institutional values and best practices", "QUALITATIVE", 100, null, null],
    ["7.2.1", "Two best practices successfully implemented by the institution", "QUALITATIVE", 30, null, null],
  ];
  const ids = new Map<string, string>();
  for (const [i, [c, title, kind, weight, source, unit]] of outline.entries()) {
    const parent = c.includes(".") ? ids.get(c.split(".")[0]) ?? null : null;
    ids.set(c, (await db.accreditationMetric.create({ data: { frameworkId: fw.id, code: c, title, kind, weight, source, unit, parentId: parent, order: i } })).id);
  }
  const year = await db.academicYear.findFirstOrThrow({ where: { isCurrent: true } });
  const cycle = await db.accreditationCycle.create({ data: { frameworkId: fw.id, academicYearId: year.id, name: `NAAC SSR data ${year.label}`, yearsCovered: 5, dueDate: new Date(s.now.getTime() + 60 * 86_400_000) } });
  const leaves = outline.filter(([c]) => c.includes("."));
  const owner: Record<string, string> = { "1": s.users.registrar.id, "2": s.users.registrar.id, "3": s.users.research.id, "5": s.users.finance.id, "7": s.users["hod.cs"].id };
  for (const [c, , kind] of leaves) {
    const status = c === "2.4.1" || c === "3.1.2" ? "APPROVED" : c === "1.1.1" ? "SUBMITTED" : c === "3.1.1" ? "DRAFT" : "NOT_STARTED";
    await db.metricResponse.create({
      data: {
        cycleId: cycle.id, metricId: ids.get(c)!, assigneeId: owner[c.split(".")[0]], status,
        value: status !== "NOT_STARTED" && kind === "QUANTITATIVE" ? (c === "2.4.1" ? 18 : c === "3.1.2" ? 2 : 3795000) : null,
        narrative: c === "1.1.1" ? "Programmes are revised every three years through the Board of Studies with inputs from industry, alumni and employers. Outcome-based curricula map course outcomes to programme outcomes, and local needs are addressed through electives in regional commerce and agri-technology." : null,
        submittedAt: status === "SUBMITTED" || status === "APPROVED" ? new Date(s.now.getTime() - 5 * 86_400_000) : null,
        reviewedAt: status === "APPROVED" ? new Date(s.now.getTime() - 3 * 86_400_000) : null, reviewedById: status === "APPROVED" ? s.users.iqac.id : null,
      },
    });
  }
}
