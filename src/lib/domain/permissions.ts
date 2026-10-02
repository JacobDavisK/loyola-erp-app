/**
 * Permission catalogue and default system roles.
 * The database is the source of truth at runtime (roles are editable by Super Admin);
 * this catalogue seeds it and gives the code type-safe permission keys.
 */

export const PERMISSIONS = {
  // Administration
  "admin.institution.manage": { module: "Administration", description: "Edit institution profile and branding" },
  "admin.users.manage": { module: "Administration", description: "Create, edit and suspend users" },
  "admin.roles.manage": { module: "Administration", description: "Manage roles, permissions and role grants" },
  "admin.settings.manage": { module: "Administration", description: "Change system, workflow and security settings" },
  "admin.templates.manage": { module: "Administration", description: "Manage paper templates and watermarks" },
  "admin.backup": { module: "Administration", description: "Run configuration backups and restores" },
  // Academic structure
  "academic.manage": { module: "Academics", description: "Manage departments, programs, regulations, years and courses" },
  "academic.view": { module: "Academics", description: "View academic structure and courses" },
  // Examinations
  "session.manage": { module: "Examinations", description: "Create and configure examination sessions" },
  "exam.manage": { module: "Examinations", description: "Manage examinations, schedules and reviewers" },
  "exam.view": { module: "Examinations", description: "View examinations in scope" },
  "exam.lock": { module: "Examinations", description: "Lock examinations and sessions" },
  // Question bank
  "question.view": { module: "Question bank", description: "View questions for courses in scope" },
  "question.create": { module: "Question bank", description: "Author new questions" },
  "question.edit.own": { module: "Question bank", description: "Edit own questions" },
  "question.edit.any": { module: "Question bank", description: "Edit any question in scope" },
  "question.retire": { module: "Question bank", description: "Retire (soft-delete) questions" },
  "question.review": { module: "Question bank", description: "Approve pending questions into the bank" },
  // Blueprints
  "blueprint.manage": { module: "Blueprints", description: "Create and edit paper blueprints/patterns" },
  "blueprint.view": { module: "Blueprints", description: "View blueprints" },
  // Assignments
  "assignment.manage": { module: "Paper setters", description: "Appoint setters, backups and deadlines" },
  "assignment.recommend": { module: "Paper setters", description: "Recommend setters for department courses" },
  "assignment.respond": { module: "Paper setters", description: "Accept or decline own assignments" },
  // Papers
  "paper.view.scope": { module: "Question papers", description: "View papers of examinations in scope (status and content)" },
  "paper.edit.own": { module: "Question papers", description: "Build and edit own assigned papers" },
  "paper.submit": { module: "Question papers", description: "Submit own papers" },
  "paper.generate": { module: "Question papers", description: "Use automatic paper generation" },
  "moderation.perform": { module: "Review", description: "Moderate papers assigned for moderation" },
  "scrutiny.perform": { module: "Review", description: "Perform scrutiny on assigned papers" },
  "paper.approve": { module: "Review", description: "Final approval decisions" },
  "paper.lock": { module: "Review", description: "Lock approved papers (immutable final version)" },
  "paper.release": { module: "Review", description: "Release locked papers to printing" },
  "paper.archive": { module: "Review", description: "Archive papers" },
  "paper.override": { module: "Review", description: "Override workflow (reopen approved/rejected papers)" },
  "paper.export.draft": { module: "Exports", description: "Download watermarked draft/moderation PDFs" },
  "paper.export.final": { module: "Exports", description: "Download final PDFs of locked papers" },
  "paper.package": { module: "Exports", description: "Build batch/ZIP printing packages" },
  // Insight
  "report.view": { module: "Reports", description: "View and export reports" },
  "analytics.view": { module: "Reports", description: "View analytics dashboards" },
  "audit.view": { module: "Security", description: "View audit logs" },
  "user.directory": { module: "Security", description: "Search the user directory" },
  // Platform
  "workflow.manage": { module: "Workflows", description: "Configure approval workflows and their steps" },
  "workflow.monitor": { module: "Workflows", description: "Monitor all workflow instances in scope, reassign stuck tasks" },
  "system.health": { module: "System", description: "View system health, background jobs and event processing" },
  // Students (SIS)
  "student.view": { module: "Students", description: "View student records in scope" },
  "student.create": { module: "Students", description: "Create student records and import students" },
  "student.update": { module: "Students", description: "Edit student profiles, guardians and contact details" },
  "student.status": { module: "Students", description: "Change academic status (suspend, withdraw, graduate…)" },
  "student.export": { module: "Students", description: "Export student data" },
  "student.delete": { module: "Students", description: "Archive (soft-delete) student records" },
  // Academic operations
  "enrollment.manage": { module: "Academic operations", description: "Manage terms, course offerings, sections and registrations" },
  "enrollment.self": { module: "Academic operations", description: "Register for own courses during the registration window" },
  "attendance.take": { module: "Academic operations", description: "Take attendance for own classes" },
  "attendance.manage": { module: "Academic operations", description: "Correct attendance for any class in scope" },
  "attendance.view": { module: "Academic operations", description: "View attendance reports in scope" },
  "timetable.manage": { module: "Academic operations", description: "Manage rooms, buildings and class timetables" },
  "curriculum.manage": { module: "Academic operations", description: "Manage curricula, prerequisites and degree requirements" },
  "faculty.view": { module: "Academic operations", description: "View faculty profiles and teaching workload in scope" },
  // Examination operations & results
  "examreg.manage": { module: "Examination operations", description: "Generate exam registrations, decide eligibility, issue hall tickets" },
  "seating.manage": { module: "Examination operations", description: "Allocate examination seating and invigilation duties" },
  "exam.duty": { module: "Examination operations", description: "See own invigilation and valuation duties" },
  "marks.enter": { module: "Marks & results", description: "Enter marks for classes one teaches" },
  "marks.verify": { module: "Marks & results", description: "Verify submitted mark sheets in scope (e.g. HoD)" },
  "marks.approve": { module: "Marks & results", description: "Approve mark sheets and correct approved marks" },
  "valuation.manage": { module: "Marks & results", description: "Code answer scripts and assign valuers" },
  "valuation.perform": { module: "Marks & results", description: "Value answer scripts assigned to one (sees dummy numbers only)" },
  "grading.manage": { module: "Marks & results", description: "Manage grading schemes" },
  "result.process": { module: "Marks & results", description: "Compute results and submit them for approval" },
  "result.view": { module: "Marks & results", description: "View results in scope" },
  "result.withhold": { module: "Marks & results", description: "Withhold or release individual results" },
  "revaluation.manage": { module: "Marks & results", description: "Process revaluation and retotalling requests" },
  "revaluation.request": { module: "Marks & results", description: "Apply for revaluation of own results" },
  "credential.issue": { module: "Credentials", description: "Issue transcripts and certificates" },
  "credential.revoke": { module: "Credentials", description: "Revoke issued credentials" },
  "credential.request": { module: "Credentials", description: "Request certificates for oneself" },
  "badge.manage": { module: "Credentials", description: "Create badges and micro-credentials and award them to students in scope" },
  "apaar.manage": { module: "Credentials", description: "Verify APAAR IDs and prepare Academic Bank of Credits / NAD-DigiLocker uploads" },
  // NEP 2020 and outcome-based education
  "nep.manage": { module: "NEP & outcomes", description: "Configure multiple-exit awards for programmes" },
  "credittransfer.review": { module: "NEP & outcomes", description: "Review SWAYAM / MOOC / inter-institution credit transfers in scope" },
  "obe.manage": { module: "NEP & outcomes", description: "Define programme outcomes and course-outcome mappings in scope" },
  "obe.view": { module: "NEP & outcomes", description: "View outcome attainment reports in scope" },
  // Teaching tools
  "survey.manage": { module: "Teaching tools", description: "Create and run feedback surveys in scope (course exit, teacher feedback, satisfaction, alumni, employers)" },
  "survey.results": { module: "Teaching tools", description: "See survey results in scope, including teacher feedback" },
  "lti.manage": { module: "Teaching tools", description: "Register external learning tools (LTI 1.3)" },
  // Student success
  "success.view": { module: "Student success", description: "See early-warning risk and support cases for students in scope" },
  "success.manage": { module: "Student success", description: "Assign, work and close support cases in scope; change early-warning rules" },
  "mentoring.manage": { module: "Student success", description: "Assign faculty mentors to students in scope" },
  "knowledge.manage": { module: "Student success", description: "Write and publish knowledge-base articles used by the assistant" },
  // Campus life
  "counselling.provide": { module: "Campus life", description: "Offer counselling slots and see one's own counselling sessions and notes" },
  "counselling.manage": { module: "Campus life", description: "Oversee the counselling service, including crisis alerts" },
  "grievance.handle": { module: "Campus life", description: "Work on department-level grievances in scope" },
  "grievance.committee": { module: "Campus life", description: "Institution grievance redressal committee: escalated grievances, ragging and harassment complaints" },
  "grievance.ombudsperson": { module: "Campus life", description: "Ombudsperson: hear appeals against the committee's decisions" },
  "antiragging.manage": { module: "Campus life", description: "Track students' annual anti-ragging undertakings" },
  "events.manage": { module: "Campus life", description: "Create clubs and campus events and record participation" },
  "convocation.manage": { module: "Campus life", description: "Plan convocations: graduates, registration, seating, gowns and degrees" },
  "messaging.manage": { module: "Campus life", description: "See the SMS / WhatsApp message log and delivery status" },
  "demo.manage": { module: "System", description: "Give people access to the demo accounts (Demo Users): enrol their e-mail and generate a password" },
  "integration.manage": { module: "System", description: "Configure single sign-on, webhooks to other systems, and see every API token" },
  // Operations
  "budget.manage": { module: "Operations", description: "Prepare and approve budgets; post depreciation" },
  "budget.view": { module: "Operations", description: "See budgets and spending against them in scope" },
  "procurement.request": { module: "Operations", description: "Raise purchase requests for one's department" },
  "procurement.manage": { module: "Operations", description: "Vendors, purchase orders, goods receipts and vendor bills" },
  "procurement.pay": { module: "Operations", description: "Approve vendor bills and record their payment" },
  "inventory.manage": { module: "Operations", description: "Stores, stock items, issues and stock counts" },
  "asset.manage": { module: "Operations", description: "Fixed-asset register: transfers, verification and disposal" },
  "facility.manage": { module: "Operations", description: "Approve bookings of halls, auditoriums and other facilities" },
  "gate.manage": { module: "Operations", description: "Gate desk: visitors and hostel out-pass check-out and return" },
  "health.manage": { module: "Operations", description: "Health centre: clinical records and medical certificates" },
  // Data protection
  "privacy.manage": { module: "Data protection", description: "Privacy notices, data-principal requests, breach register and retention rules" },
  // Finance
  "finance.view": { module: "Finance", description: "View invoices, payments and balances in scope" },
  "fee.manage": { module: "Finance", description: "Manage fee heads and fee structures" },
  "invoice.manage": { module: "Finance", description: "Raise, generate and cancel invoices" },
  "payment.record": { module: "Finance", description: "Record counter payments and issue receipts" },
  "payment.reverse": { module: "Finance", description: "Reverse payments (bounced cheques, errors) and manage refunds" },
  "concession.request": { module: "Finance", description: "Request fee concessions and waivers for students in scope" },
  "scholarship.manage": { module: "Finance", description: "Manage scholarship schemes and review applications" },
  "scholarship.apply": { module: "Finance", description: "Apply for scholarships for oneself" },
  "ledger.manage": { module: "Finance", description: "Chart of accounts and manual journal entries" },
  "finance.report": { module: "Finance", description: "Finance reports and exports" },
  // Human resources
  "hr.view": { module: "Human resources", description: "View employee records in scope" },
  "hr.manage": { module: "Human resources", description: "Create and update employees, positions and leave policy" },
  "leave.manage": { module: "Human resources", description: "Record leave on behalf of staff and adjust leave balances" },
  "attendance.staff": { module: "Human resources", description: "Mark staff attendance in scope" },
  "payroll.process": { module: "Human resources", description: "Salary structures, employee pay and payroll runs" },
  "payroll.view": { module: "Human resources", description: "View payroll runs and payslips" },
  "payroll.disburse": { module: "Human resources", description: "Mark approved payroll as paid (posts the bank entry)" },
  "appraisal.manage": { module: "Human resources", description: "Run appraisal cycles" },
  // Research & quality
  "research.view": { module: "Research & IQAC", description: "View research projects and publications in scope" },
  "research.manage": { module: "Research & IQAC", description: "Sanction projects, record grant spending, verify publications" },
  "iqac.view": { module: "Research & IQAC", description: "View accreditation cycles, metric responses and progress" },
  "iqac.manage": { module: "Research & IQAC", description: "Manage frameworks and cycles, assign and review metric responses" },
  // Campus services
  "library.circulate": { module: "Campus services", description: "Issue, renew and receive library items" },
  "library.manage": { module: "Campus services", description: "Library catalogue, copies and circulation rules" },
  "hostel.manage": { module: "Campus services", description: "Hostels, rooms and allocations" },
  "transport.manage": { module: "Campus services", description: "Transport routes and passes" },
  "helpdesk.agent": { module: "Campus services", description: "Work on helpdesk tickets" },
  "helpdesk.manage": { module: "Campus services", description: "Helpdesk categories, assignment and reports" },
  "announcement.publish": { module: "Campus services", description: "Publish institution announcements" },
  "document.verify": { module: "Campus services", description: "Verify student documents in scope" },
  "admission.view": { module: "Admissions & careers", description: "View admission cycles and applications" },
  "admission.manage": { module: "Admissions & careers", description: "Run admission cycles: verify, offer and enrol applicants" },
  "placement.manage": { module: "Admissions & careers", description: "Companies, placement drives and selections" },
  "alumni.view": { module: "Admissions & careers", description: "View the alumni directory and outcomes" },
  // Self-service
  "self.portal": { module: "Self-service", description: "Use the student / guardian self-service portal" },
} as const satisfies Record<string, { module: string; description: string }>;

export type PermissionKey = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

/**
 * How a role's grants are scoped:
 *  - global      every department (the grant's scope fields are ignored)
 *  - department  one department (grant.departmentId, falling back to the user's department)
 *  - unit        a faculty/school/centre and everything below it (grant.academicUnitId)
 *  - campus      every department on a campus (grant.campusId)
 *  - self        no institutional data; self-service only (students, guardians)
 * The scope is chosen per grant; `defaultScope` is what the admin UI proposes.
 */
export type RoleScope = "global" | "department" | "unit" | "campus" | "self";

export interface SystemRoleDef {
  name: string;
  description: string;
  rank: number;
  global: boolean;
  defaultScope: RoleScope;
  permissions: PermissionKey[];
}

const EXAM_ROLES = {
  SUPER_ADMIN: {
    name: "Super Admin",
    description: "Complete control of every module, with every permission of every role. Can act on any approval, class, paper, script or student portal (never on a request they raised themselves).",
    rank: 0,
    global: true,
    defaultScope: "global",
    // Institution policy: the Super Admin holds every permission. See isSuperAdmin() for the relationship-bound
    // abilities (acting as any approver, instructor, moderator, scrutiniser or valuer, and viewing any student's portal).
    permissions: [...ALL_PERMISSIONS],
  },
  EXAM_CONTROLLER: {
    name: "Controller of Examinations",
    description: "Central examination authority: sessions, appointments, approval, locking and release.",
    rank: 10,
    global: true,
    defaultScope: "global",
    permissions: [
      "academic.view", "session.manage", "exam.manage", "exam.view", "exam.lock", "question.view",
      "question.review", "question.edit.any", "question.retire", "blueprint.manage", "blueprint.view",
      "assignment.manage", "paper.view.scope", "paper.approve", "paper.lock", "paper.release", "paper.archive",
      "paper.override", "paper.export.draft", "paper.export.final", "paper.package", "report.view",
      "analytics.view", "audit.view", "user.directory", "admin.templates.manage", "student.view", "workflow.monitor",
      "examreg.manage", "seating.manage", "marks.approve", "valuation.manage", "grading.manage", "result.process", "result.view",
      "result.withhold", "revaluation.manage", "credential.issue", "attendance.view", "apaar.manage", "obe.view", "badge.manage",
    ],
  },
  DEPUTY_CONTROLLER: {
    name: "Deputy Controller of Examinations",
    description: "Operational examination management on behalf of the Controller.",
    rank: 20,
    global: true,
    defaultScope: "global",
    permissions: [
      "academic.view", "session.manage", "exam.manage", "exam.view", "question.view", "blueprint.manage",
      "blueprint.view", "assignment.manage", "paper.view.scope", "paper.release", "paper.export.draft",
      "paper.export.final", "paper.package", "report.view", "analytics.view", "user.directory", "student.view",
      "examreg.manage", "seating.manage", "valuation.manage", "result.process", "result.view", "revaluation.manage", "attendance.view",
    ],
  },
  EXAM_CELL_STAFF: {
    name: "Examination Officer",
    description: "Examination records, setter coordination, submission tracking and reports.",
    rank: 30,
    global: true,
    defaultScope: "global",
    permissions: ["academic.view", "exam.view", "blueprint.view", "assignment.manage", "report.view", "user.directory", "student.view", "examreg.manage", "seating.manage", "result.view", "attendance.view"],
  },
  HOD: {
    name: "Head of Department",
    description: "Departmental oversight: students, attendance, faculty workload, setter recommendations and question review.",
    rank: 40,
    global: false,
    defaultScope: "department",
    permissions: [
      "academic.view", "exam.view", "question.view", "question.create", "question.edit.own", "question.review",
      "blueprint.view", "assignment.recommend", "paper.view.scope", "report.view", "user.directory",
      "student.view", "student.status", "attendance.view", "attendance.manage", "enrollment.manage", "faculty.view",
      "marks.enter", "marks.verify", "result.view", "exam.duty", "concession.request", "hr.view", "attendance.staff", "research.view", "iqac.view",
      "credittransfer.review", "obe.manage", "obe.view", "success.view", "success.manage", "mentoring.manage", "survey.manage", "survey.results", "badge.manage", "grievance.handle", "procurement.request", "budget.view",
    ],
  },
  SETTER: {
    name: "Question Paper Setter",
    description: "Builds and submits assigned papers; contributes to the question bank.",
    rank: 60,
    global: false,
    defaultScope: "department",
    permissions: [
      "academic.view", "question.view", "question.create", "question.edit.own", "blueprint.view",
      "assignment.respond", "paper.edit.own", "paper.submit", "paper.generate", "paper.export.draft",
    ],
  },
  MODERATOR: {
    name: "Question Paper Moderator",
    description: "Reviews submitted papers against blueprint, syllabus and quality standards.",
    rank: 50,
    global: false,
    defaultScope: "department",
    permissions: ["academic.view", "question.view", "blueprint.view", "moderation.perform", "paper.export.draft"],
  },
  SCRUTINY_OFFICER: {
    name: "Scrutiny Officer",
    description: "Final technical and formatting checks before approval.",
    rank: 50,
    global: false,
    defaultScope: "department",
    permissions: ["academic.view", "blueprint.view", "scrutiny.perform", "paper.export.draft"],
  },
  APPROVER: {
    name: "Approving Authority",
    description: "Approves, returns or rejects final papers and locks the approved version.",
    rank: 15,
    global: true,
    defaultScope: "global",
    permissions: [
      "academic.view", "exam.view", "blueprint.view", "paper.view.scope", "paper.approve", "paper.lock",
      "paper.export.draft", "paper.export.final", "report.view",
    ],
  },
  AUDITOR: {
    name: "Auditor",
    description: "Read-only access to status, reports and audit trails. No paper content, no personal records.",
    rank: 90,
    global: true,
    defaultScope: "global",
    permissions: ["academic.view", "exam.view", "blueprint.view", "report.view", "analytics.view", "audit.view", "finance.view", "finance.report", "iqac.view"],
  },
} as const satisfies Record<string, SystemRoleDef>;

const UNIVERSITY_ROLES = {
  UNIVERSITY_ADMIN: {
    name: "University Administrator",
    description: "Runs master data, users and academic configuration. No examination content.",
    rank: 5,
    global: true,
    defaultScope: "global",
    permissions: [
      "admin.users.manage", "admin.institution.manage", "academic.manage", "academic.view", "curriculum.manage",
      "timetable.manage", "enrollment.manage", "student.view", "student.create", "student.update", "student.status",
      "student.export", "faculty.view", "attendance.view", "report.view", "analytics.view", "user.directory",
      "workflow.manage", "workflow.monitor", "hr.view", "announcement.publish", "helpdesk.manage", "helpdesk.agent", "knowledge.manage", "lti.manage",
    ],
  },
  REGISTRAR: {
    name: "Registrar",
    description: "Custodian of student records: admission to graduation, academic status, terms and registrations.",
    rank: 8,
    global: true,
    defaultScope: "global",
    permissions: [
      "academic.manage", "academic.view", "curriculum.manage", "timetable.manage", "enrollment.manage",
      "student.view", "student.create", "student.update", "student.status", "student.export", "student.delete",
      "attendance.view", "attendance.manage", "faculty.view", "exam.view", "report.view", "analytics.view",
      "user.directory", "workflow.monitor", "result.view", "credential.issue", "credential.revoke", "finance.view", "finance.report", "hr.view", "payroll.view", "research.view", "iqac.view", "announcement.publish", "admission.view", "alumni.view", "document.verify",
      "apaar.manage", "nep.manage", "credittransfer.review", "obe.view", "success.view", "success.manage", "mentoring.manage", "knowledge.manage", "survey.manage", "survey.results", "badge.manage", "convocation.manage", "antiragging.manage",
    ],
  },
  DEAN: {
    name: "Dean",
    description: "Academic leadership of a faculty or school: students, faculty workload, attendance and results in the unit.",
    rank: 12,
    global: false,
    defaultScope: "unit",
    permissions: [
      "academic.view", "exam.view", "student.view", "attendance.view", "faculty.view", "enrollment.manage",
      "report.view", "analytics.view", "user.directory", "result.view", "hr.view", "research.view", "iqac.view", "obe.view", "success.view",
    ],
  },
  ASSOCIATE_DEAN: {
    name: "Associate Dean",
    description: "Supports the Dean; read access across the unit.",
    rank: 14,
    global: false,
    defaultScope: "unit",
    permissions: ["academic.view", "exam.view", "student.view", "attendance.view", "faculty.view", "report.view", "user.directory"],
  },
  PRINCIPAL: {
    name: "Principal",
    description: "Head of a campus or constituent college: oversight of every department on the campus.",
    rank: 9,
    global: false,
    defaultScope: "campus",
    permissions: [
      "academic.view", "exam.view", "student.view", "student.status", "attendance.view", "faculty.view",
      "enrollment.manage", "report.view", "analytics.view", "user.directory", "result.view", "hr.view", "attendance.staff", "research.view", "iqac.view", "obe.view", "success.view",
    ],
  },
  FACULTY: {
    name: "Faculty",
    description: "Teaches courses: own classes, attendance and students of the department.",
    rank: 55,
    global: false,
    defaultScope: "department",
    permissions: ["academic.view", "student.view", "attendance.take", "marks.enter", "exam.duty", "user.directory"],
  },
  VISITING_FACULTY: {
    name: "Visiting Faculty",
    description: "Teaches assigned classes only; no departmental records.",
    rank: 65,
    global: false,
    defaultScope: "department",
    permissions: ["academic.view", "attendance.take", "marks.enter", "exam.duty"],
  },
  STUDENT: {
    name: "Student",
    description: "Self-service portal: own profile, courses, attendance, timetable and registrations.",
    rank: 100,
    global: false,
    defaultScope: "self",
    permissions: ["self.portal", "enrollment.self", "revaluation.request", "credential.request", "scholarship.apply"],
  },
  GUARDIAN: {
    name: "Parent / Guardian",
    description: "Read-only view of linked students' attendance, results and fees.",
    rank: 110,
    global: false,
    defaultScope: "self",
    permissions: ["self.portal"],
  },
  IT_ADMIN: {
    name: "IT Administrator",
    description: "Accounts, sessions, system health and integrations. No academic or examination content.",
    rank: 6,
    global: true,
    defaultScope: "global",
    permissions: ["admin.users.manage", "admin.settings.manage", "system.health", "audit.view", "user.directory", "helpdesk.agent", "lti.manage", "messaging.manage", "integration.manage"],
  },
  VALUER: {
    name: "Valuer",
    description: "Values answer scripts assigned to them. Sees dummy numbers only, never student identities.",
    rank: 70,
    global: false,
    defaultScope: "department",
    permissions: ["valuation.perform", "exam.duty"],
  },
  EXTERNAL_EXAMINER: {
    name: "External Examiner",
    description: "External valuer or moderator appointed for a session; access limited to assigned scripts and papers.",
    rank: 72,
    global: false,
    defaultScope: "department",
    permissions: ["valuation.perform", "moderation.perform", "paper.export.draft", "exam.duty"],
  },
  INVIGILATOR: {
    name: "Invigilator",
    description: "Sees own invigilation duties and the seating plan of assigned rooms.",
    rank: 75,
    global: false,
    defaultScope: "department",
    permissions: ["exam.duty"],
  },
  FINANCE_OFFICER: {
    name: "Finance Officer",
    description: "Fee structures, invoicing, concessions, scholarships and collections.",
    rank: 18,
    global: true,
    defaultScope: "global",
    permissions: ["finance.view", "fee.manage", "invoice.manage", "payment.record", "concession.request", "scholarship.manage", "finance.report", "student.view", "academic.view", "user.directory", "payroll.view", "budget.manage", "budget.view", "procurement.pay"],
  },
  ACCOUNTS_OFFICER: {
    name: "Accounts Officer",
    description: "Counter collections, reversals, refunds, the ledger and reconciliation.",
    rank: 22,
    global: true,
    defaultScope: "global",
    permissions: ["finance.view", "payment.record", "payment.reverse", "ledger.manage", "finance.report", "student.view", "payroll.view", "payroll.disburse", "procurement.pay", "budget.view"],
  },
  HR_OFFICER: {
    name: "HR Officer",
    description: "Employee records, leave, staff attendance, payroll and appraisals.",
    rank: 20,
    global: true,
    defaultScope: "global",
    permissions: ["hr.view", "hr.manage", "leave.manage", "attendance.staff", "payroll.process", "payroll.view", "appraisal.manage", "faculty.view", "user.directory", "report.view"],
  },
  RESEARCH_DEAN: {
    name: "Dean of Research",
    description: "Research proposals, grants, spending and publication verification across the institution.",
    rank: 16,
    global: true,
    defaultScope: "global",
    permissions: ["research.view", "research.manage", "iqac.view", "faculty.view", "report.view", "analytics.view", "user.directory"],
  },
  IQAC_COORDINATOR: {
    name: "IQAC Coordinator",
    description: "Accreditation frameworks and cycles: assigns metrics to data owners and reviews their responses and evidence.",
    rank: 17,
    global: true,
    defaultScope: "global",
    permissions: ["iqac.view", "iqac.manage", "research.view", "academic.view", "report.view", "analytics.view", "user.directory", "obe.view", "obe.manage", "survey.manage", "survey.results"],
  },
  LIBRARIAN: {
    name: "Librarian",
    description: "Library catalogue, circulation, holds and fines.",
    rank: 40,
    global: true,
    defaultScope: "global",
    permissions: ["library.circulate", "library.manage", "user.directory"],
  },
  LIBRARY_ASSISTANT: {
    name: "Library Assistant",
    description: "Circulation desk: issue, renew and receive items.",
    rank: 60,
    global: true,
    defaultScope: "global",
    permissions: ["library.circulate"],
  },
  HOSTEL_WARDEN: {
    name: "Hostel Warden",
    description: "Hostel rooms and allocations.",
    rank: 45,
    global: true,
    defaultScope: "global",
    permissions: ["hostel.manage", "student.view", "user.directory", "gate.manage"],
  },
  TRANSPORT_OFFICER: {
    name: "Transport Officer",
    description: "Routes, capacity and student transport passes.",
    rank: 45,
    global: true,
    defaultScope: "global",
    permissions: ["transport.manage", "student.view", "user.directory"],
  },
  HELPDESK_AGENT: {
    name: "Helpdesk Agent",
    description: "Works on helpdesk tickets.",
    rank: 60,
    global: true,
    defaultScope: "global",
    permissions: ["helpdesk.agent", "user.directory", "knowledge.manage"],
  },
  ADMISSIONS_OFFICER: {
    name: "Admissions Officer",
    description: "Admission cycles, seat matrix, verification, merit offers and enrolment.",
    rank: 25,
    global: true,
    defaultScope: "global",
    permissions: ["admission.view", "admission.manage", "student.create", "student.view", "document.verify", "academic.view", "user.directory"],
  },
  PLACEMENT_OFFICER: {
    name: "Placement Officer",
    description: "Companies, drives, eligibility, selections and alumni outcomes.",
    rank: 30,
    global: true,
    defaultScope: "global",
    permissions: ["placement.manage", "alumni.view", "student.view", "academic.view", "user.directory", "report.view"],
  },
  DATA_PROTECTION_OFFICER: {
    name: "Data Protection Officer",
    description: "DPDP Act compliance: privacy notices and consent, data-principal requests, the breach register and retention.",
    rank: 19,
    global: true,
    defaultScope: "global",
    permissions: ["privacy.manage", "audit.view", "user.directory", "report.view"],
  },
  DEAN_STUDENT_WELFARE: {
    name: "Dean of Student Welfare",
    description: "Student grievance redressal committee, anti-ragging, clubs and events.",
    rank: 16,
    global: true,
    defaultScope: "global",
    permissions: ["grievance.committee", "antiragging.manage", "events.manage", "badge.manage", "student.view", "success.view", "user.directory", "report.view"],
  },
  COUNSELLOR: {
    name: "Student Counsellor",
    description: "Offers counselling sessions. Session notes are confidential to the counselling service.",
    rank: 45,
    global: true,
    defaultScope: "global",
    permissions: ["counselling.provide", "user.directory"],
  },
  OMBUDSPERSON: {
    name: "Ombudsperson",
    description: "Hears students' appeals against the grievance committee's decisions (UGC Regulations 2023).",
    rank: 18,
    global: true,
    defaultScope: "global",
    permissions: ["grievance.ombudsperson", "user.directory"],
  },
  PURCHASE_OFFICER: {
    name: "Purchase Officer",
    description: "Vendors, purchase orders and goods receipts.",
    rank: 30,
    global: true,
    defaultScope: "global",
    permissions: ["procurement.manage", "inventory.manage", "budget.view", "user.directory"],
  },
  STORE_KEEPER: {
    name: "Store Keeper",
    description: "Stores: receipts, issues to departments and stock counts.",
    rank: 50,
    global: true,
    defaultScope: "global",
    permissions: ["inventory.manage", "user.directory"],
  },
  ESTATE_OFFICER: {
    name: "Estate Officer",
    description: "Fixed assets, buildings and facility bookings.",
    rank: 30,
    global: true,
    defaultScope: "global",
    permissions: ["asset.manage", "facility.manage", "academic.view", "user.directory"],
  },
  SECURITY_OFFICER: {
    name: "Security Officer",
    description: "Gate desk: visitors and hostel out-passes.",
    rank: 70,
    global: true,
    defaultScope: "global",
    permissions: ["gate.manage", "user.directory"],
  },
  MEDICAL_OFFICER: {
    name: "Medical Officer",
    description: "Health centre: consultations, clinical records and medical certificates.",
    rank: 40,
    global: true,
    defaultScope: "global",
    permissions: ["health.manage", "user.directory"],
  },
  CHIEF_SUPERINTENDENT: {
    name: "Chief Superintendent",
    description: "In charge of an examination centre on exam days: seating plans and invigilation for the centre.",
    rank: 35,
    global: false,
    defaultScope: "campus",
    permissions: ["exam.view", "exam.duty", "seating.manage", "student.view"],
  },
} as const satisfies Record<string, SystemRoleDef>;

export const SYSTEM_ROLES: Record<keyof typeof EXAM_ROLES | keyof typeof UNIVERSITY_ROLES, SystemRoleDef> = { ...EXAM_ROLES, ...UNIVERSITY_ROLES };
export type SystemRoleKey = keyof typeof SYSTEM_ROLES;

/** Roles whose holders only ever see their own (or their ward's) records. */
export const SELF_SCOPED_ROLES: readonly string[] = Object.entries(SYSTEM_ROLES)
  .filter(([, r]) => r.defaultScope === "self")
  .map(([k]) => k);
