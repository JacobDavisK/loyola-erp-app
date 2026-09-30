import type { PermissionKey } from "@/lib/domain/permissions";

export interface NavItem {
  label: string;
  href: string;
  icon: string;
  any?: PermissionKey[]; // visible if the user holds any of these
  /** "staff" items are hidden from student/guardian accounts; "self" items only show to them */
  audience?: "staff" | "self";
  /** Only for accounts linked to an employee record (HR self-service) */
  employee?: boolean;
  /** Only for the Super Admin */
  superAdmin?: boolean;
  badgeKey?: "moderation" | "scrutiny" | "approvals" | "assignments" | "inbox";
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: "layout-dashboard", audience: "staff" },
      { label: "My portal", href: "/portal", icon: "layout-dashboard", audience: "self", any: ["self.portal"] },
      { label: "Approval centre", href: "/inbox", icon: "inbox", badgeKey: "inbox", audience: "staff" },
      { label: "Student portal (view as)", href: "/portal", icon: "graduation-cap", audience: "staff", superAdmin: true },
      { label: "Notifications", href: "/notifications", icon: "bell" },
      { label: "Announcements", href: "/announcements", icon: "megaphone" },
      { label: "Helpdesk", href: "/helpdesk", icon: "life-buoy" },
    ],
  },
  {
    label: "My studies",
    items: [
      { label: "Courses", href: "/portal/courses", icon: "book-open", audience: "self", any: ["enrollment.self"] },
      { label: "Attendance", href: "/portal/attendance", icon: "percent", audience: "self", any: ["self.portal"] },
      { label: "Course registration", href: "/portal/registration", icon: "clipboard-check", audience: "self", any: ["enrollment.self"] },
      { label: "Examinations", href: "/portal/exams", icon: "ticket", audience: "self", any: ["self.portal"] },
      { label: "Results", href: "/portal/results", icon: "award", audience: "self", any: ["self.portal"] },
      { label: "Fees", href: "/portal/fees", icon: "wallet", audience: "self", any: ["self.portal"] },
      { label: "Placements", href: "/portal/placements", icon: "briefcase", audience: "self", any: ["enrollment.self"] },
      { label: "Services & documents", href: "/portal/services", icon: "building-2", audience: "self", any: ["enrollment.self"] },
      { label: "Library", href: "/library", icon: "library", audience: "self", any: ["enrollment.self"] },
    ],
  },
  {
    label: "My work",
    items: [
      { label: "Leave", href: "/me/leave", icon: "calendar-off", audience: "staff", employee: true },
      { label: "Payslips", href: "/me/payslips", icon: "banknote", audience: "staff", employee: true },
      { label: "Appraisal", href: "/me/appraisal", icon: "award", audience: "staff", employee: true },
      { label: "My research", href: "/me/research", icon: "flask", audience: "staff", employee: true },
      { label: "Accreditation tasks", href: "/iqac/my", icon: "list-checks", audience: "staff", employee: true },
    ],
  },
  {
    label: "Teaching",
    items: [
      { label: "My teaching", href: "/teaching", icon: "presentation", any: ["attendance.take"], audience: "staff" },
      { label: "My exam duties", href: "/duties", icon: "shield-check", any: ["exam.duty"], audience: "staff" },
      { label: "Valuation", href: "/valuation", icon: "pen-line", any: ["valuation.perform"], audience: "staff" },
    ],
  },
  {
    label: "Students",
    items: [
      { label: "Students", href: "/students", icon: "graduation-cap", any: ["student.view"], audience: "staff" },
      { label: "Import students", href: "/students/import", icon: "upload", any: ["student.create"], audience: "staff" },
    ],
  },
  {
    label: "Academics",
    items: [
      { label: "Classes", href: "/academics/offerings", icon: "school", any: ["academic.view", "enrollment.manage"], audience: "staff" },
      { label: "Timetable", href: "/academics/timetable", icon: "calendar-clock", any: ["academic.view", "timetable.manage"], audience: "staff" },
      { label: "Terms & calendar", href: "/academics/terms", icon: "calendar-days", any: ["academic.view", "enrollment.manage"], audience: "staff" },
      { label: "Courses", href: "/academics/courses", icon: "book-open", any: ["academic.view"], audience: "staff" },
      { label: "Curricula", href: "/academics/curricula", icon: "route", any: ["academic.view", "curriculum.manage"], audience: "staff" },
      { label: "Batches", href: "/academics/batches", icon: "users-round", any: ["academic.view"], audience: "staff" },
      { label: "Rooms", href: "/academics/rooms", icon: "door-open", any: ["academic.view", "timetable.manage"], audience: "staff" },
      { label: "Institution structure", href: "/academics/structure", icon: "building-2", any: ["academic.view"], audience: "staff" },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Finance overview", href: "/finance", icon: "wallet", any: ["finance.view"], audience: "staff" },
      { label: "Invoices", href: "/finance/invoices", icon: "file-text", any: ["finance.view"], audience: "staff" },
      { label: "Payments", href: "/finance/payments", icon: "banknote", any: ["finance.view"], audience: "staff" },
      { label: "Scholarships", href: "/finance/scholarships", icon: "graduation-cap", any: ["scholarship.manage"], audience: "staff" },
      { label: "Fee setup", href: "/finance/setup", icon: "settings", any: ["fee.manage"], audience: "staff" },
      { label: "Ledger", href: "/finance/ledger", icon: "book-open", any: ["ledger.manage"], audience: "staff" },
    ],
  },
  {
    label: "People",
    items: [
      { label: "Employees", href: "/hr/employees", icon: "contact", any: ["hr.view"], audience: "staff" },
      { label: "Leave", href: "/hr/leave", icon: "calendar-off", any: ["hr.view", "leave.manage"], audience: "staff" },
      { label: "Staff attendance", href: "/hr/attendance", icon: "user-check", any: ["attendance.staff"], audience: "staff" },
      { label: "Payroll", href: "/hr/payroll", icon: "briefcase", any: ["payroll.process", "payroll.view"], audience: "staff" },
      { label: "HR setup", href: "/hr/setup", icon: "settings", any: ["hr.manage", "payroll.process"], audience: "staff" },
    ],
  },
  {
    label: "Campus",
    items: [
      { label: "Library", href: "/library", icon: "library", audience: "staff" },
      { label: "Hostels", href: "/hostels", icon: "bed", any: ["hostel.manage"], audience: "staff" },
      { label: "Transport", href: "/transport", icon: "bus", any: ["transport.manage"], audience: "staff" },
    ],
  },
  {
    label: "Admissions & careers",
    items: [
      { label: "Admissions", href: "/admissions", icon: "user-plus", any: ["admission.view", "admission.manage"], audience: "staff" },
      { label: "Placements", href: "/placements", icon: "briefcase", any: ["placement.manage"], audience: "staff" },
      { label: "Alumni", href: "/alumni", icon: "users-round", any: ["alumni.view"], audience: "staff" },
    ],
  },
  {
    label: "Research & quality",
    items: [
      { label: "Research", href: "/research", icon: "flask", any: ["research.view"], audience: "staff" },
      { label: "Publications", href: "/research/publications", icon: "book-open", any: ["research.view"], audience: "staff" },
      { label: "IQAC & accreditation", href: "/iqac", icon: "badge-check", any: ["iqac.view"], audience: "staff" },
    ],
  },
  {
    label: "Examinations",
    items: [
      { label: "Sessions", href: "/examinations/sessions", icon: "calendar-range", any: ["exam.view", "session.manage"] },
      { label: "Examinations", href: "/examinations", icon: "clipboard-list", any: ["exam.view"] },
      { label: "Exam calendar", href: "/examinations/calendar", icon: "calendar-days", any: ["exam.view"] },
      { label: "Status board", href: "/examinations/status", icon: "activity", any: ["exam.view"] },
      { label: "Exam operations", href: "/exam-ops", icon: "ticket", any: ["examreg.manage", "seating.manage", "valuation.manage"], audience: "staff" },
    ],
  },
  {
    label: "Results",
    items: [
      { label: "Result processing", href: "/results", icon: "award", any: ["result.process", "result.view"], audience: "staff" },
      { label: "Revaluation desk", href: "/results/revaluation", icon: "refresh-ccw", any: ["revaluation.manage"], audience: "staff" },
      { label: "Grading schemes", href: "/results/grading", icon: "ruler", any: ["grading.manage"], audience: "staff" },
    ],
  },
  {
    label: "Question papers",
    items: [
      { label: "My assignments", href: "/assignments", icon: "inbox", any: ["assignment.respond"], badgeKey: "assignments" },
      { label: "Question papers", href: "/papers", icon: "file-text", any: ["paper.view.scope", "paper.edit.own", "moderation.perform", "scrutiny.perform", "paper.approve"] },
      { label: "Question bank", href: "/question-bank", icon: "library", any: ["question.view"] },
      { label: "Taxonomy", href: "/question-bank/taxonomy", icon: "tags", any: ["question.view"] },
      { label: "Usage history", href: "/question-bank/usage", icon: "history", any: ["question.view"] },
      { label: "Blueprints", href: "/blueprints", icon: "ruler", any: ["blueprint.view"] },
      { label: "Paper setters", href: "/setters", icon: "users-round", any: ["assignment.manage", "assignment.recommend"] },
    ],
  },
  {
    label: "Paper review",
    items: [
      { label: "Moderation", href: "/moderation", icon: "scan-search", any: ["moderation.perform"], badgeKey: "moderation" },
      { label: "Scrutiny", href: "/scrutiny", icon: "list-checks", any: ["scrutiny.perform"], badgeKey: "scrutiny" },
      { label: "Paper approvals", href: "/approvals", icon: "stamp", any: ["paper.approve"], badgeKey: "approvals" },
      { label: "Packaging", href: "/packaging", icon: "package", any: ["paper.package"] },
      { label: "Archive", href: "/archive", icon: "archive", any: ["paper.view.scope"] },
    ],
  },
  {
    label: "Insight",
    items: [
      { label: "Institution analytics", href: "/insights", icon: "chart-line", audience: "staff" },
      { label: "Report builder", href: "/reports/builder", icon: "file-bar-chart", audience: "staff" },
      { label: "Examination reports", href: "/reports", icon: "file-bar-chart", any: ["report.view"] },
      { label: "Analytics", href: "/analytics", icon: "chart-line", any: ["analytics.view"] },
      { label: "Audit logs", href: "/audit", icon: "shield-check", any: ["audit.view"] },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Templates & branding", href: "/templates", icon: "palette", any: ["admin.templates.manage"] },
      { label: "Configuration centre", href: "/admin", icon: "settings", any: ["admin.users.manage", "admin.roles.manage", "admin.settings.manage", "admin.institution.manage", "workflow.manage", "system.health"] },
    ],
  },
];
