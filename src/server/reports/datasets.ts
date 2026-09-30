import "server-only";
import {
  ApplicantStatus, EmployeeCategory, EmployeeStatus, EmploymentType, Gender, Indexing, InvoiceStatus, PaymentMethod, PaymentStatus, PlacementStatus, PublicationType, StudentStatus,
  TicketPriority, TicketStatus, CourseResultStatus,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import type { FieldType } from "@/lib/domain/report";
import type { PermissionKey } from "@/lib/domain/permissions";
import { studentWhere } from "@/server/auth/access";
import { type AuthContext, scopeOf } from "@/server/auth/current";
import { invoiceWhere } from "@/server/services/finance";
import { employeeWhere } from "@/server/services/hr";
import { publicationWhere } from "@/server/services/research";
import { resultWhere } from "@/server/services/results";

/**
 * Report datasets. Each declares the permission needed, the object-level scope (the same where-builders the
 * rest of the application uses, so a report can never show more than the screens do) and a field catalogue.
 * Fields with a `path` are read and filtered in the database; `compute` fields are derived per row.
 */

type Raw = Record<string, unknown>;
export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  path?: string[];
  compute?: { deps: string[][]; fn: (row: Raw) => number | string | null };
  options?: string[];
  groupable?: boolean;
}
export interface Dataset {
  key: string;
  label: string;
  description: string;
  permission: PermissionKey;
  model: "student" | "invoice" | "payment" | "courseResult" | "employee" | "publication" | "ticket" | "libraryLoan" | "admissionApplication" | "placementApplication";
  scope: (ctx: AuthContext) => Promise<unknown> | unknown;
  fields: FieldDef[];
  /** Personal data sets are flagged in the UI and in exports */
  personal: boolean;
}

const vals = (e: Record<string, string>) => Object.values(e);
const get = (row: Raw, path: string[]): unknown => path.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Raw)[k] : undefined), row);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const deptScope = (ctx: AuthContext, perm: PermissionKey) => {
  const s = scopeOf(ctx, perm);
  return s === null ? {} : { departmentId: { in: s.length ? s : ["__none__"] } };
};

export const DATASETS: Dataset[] = [
  {
    key: "students", label: "Students", description: "One row per student in your scope.", permission: "student.view", model: "student", personal: true,
    scope: (ctx) => studentWhere(ctx),
    fields: [
      { key: "studentNo", label: "Student no.", type: "string", path: ["studentNo"] },
      { key: "firstName", label: "First name", type: "string", path: ["firstName"] },
      { key: "lastName", label: "Last name", type: "string", path: ["lastName"] },
      { key: "program", label: "Programme", type: "string", path: ["program", "code"] },
      { key: "batch", label: "Batch", type: "string", path: ["batch", "code"] },
      { key: "admissionYear", label: "Admission year", type: "number", path: ["batch", "admissionYear"] },
      { key: "department", label: "Department", type: "string", path: ["department", "code"] },
      { key: "semester", label: "Semester", type: "number", path: ["currentSemester"] },
      { key: "section", label: "Section", type: "string", path: ["section"] },
      { key: "status", label: "Status", type: "enum", path: ["status"], options: vals(StudentStatus) },
      { key: "gender", label: "Gender", type: "enum", path: ["gender"], options: vals(Gender) },
      { key: "category", label: "Category", type: "string", path: ["category"] },
      { key: "admittedOn", label: "Admitted on", type: "date", path: ["admittedOn"] },
    ],
  },
  {
    key: "invoices", label: "Fee invoices", description: "Invoices with totals, payments and balances.", permission: "finance.view", model: "invoice", personal: true,
    scope: (ctx) => invoiceWhere(ctx),
    fields: [
      { key: "number", label: "Invoice no.", type: "string", path: ["number"] },
      { key: "studentNo", label: "Student no.", type: "string", path: ["student", "studentNo"] },
      { key: "program", label: "Programme", type: "string", path: ["student", "program", "code"] },
      { key: "batch", label: "Batch", type: "string", path: ["student", "batch", "code"] },
      { key: "term", label: "Term", type: "string", path: ["term", "name"] },
      { key: "status", label: "Status", type: "enum", path: ["status"], options: vals(InvoiceStatus) },
      { key: "issueDate", label: "Issued", type: "date", path: ["issueDate"] },
      { key: "dueDate", label: "Due", type: "date", path: ["dueDate"] },
      { key: "total", label: "Total", type: "money", path: ["total"] },
      { key: "amountPaid", label: "Paid", type: "money", path: ["amountPaid"] },
      { key: "balance", label: "Balance", type: "money", compute: { deps: [["total"], ["amountPaid"]], fn: (r) => Math.round((Number(r.total) - Number(r.amountPaid)) * 100) / 100 } },
      { key: "source", label: "Raised for", type: "string", path: ["sourceType"] },
    ],
  },
  {
    key: "payments", label: "Payments", description: "Receipts, methods and reversals.", permission: "finance.view", model: "payment", personal: true,
    scope: (ctx) => ({ student: deptScope(ctx, "finance.view") }),
    fields: [
      { key: "receiptNo", label: "Receipt no.", type: "string", path: ["receiptNo"] },
      { key: "studentNo", label: "Student no.", type: "string", path: ["student", "studentNo"] },
      { key: "program", label: "Programme", type: "string", path: ["student", "program", "code"] },
      { key: "method", label: "Method", type: "enum", path: ["method"], options: vals(PaymentMethod) },
      { key: "status", label: "Status", type: "enum", path: ["status"], options: vals(PaymentStatus) },
      { key: "amount", label: "Amount", type: "money", path: ["amount"] },
      { key: "receivedAt", label: "Received", type: "date", path: ["receivedAt"] },
    ],
  },
  {
    key: "results", label: "Course results", description: "Current course results with grades.", permission: "result.view", model: "courseResult", personal: true,
    scope: (ctx) => ({ AND: [resultWhere(ctx), { isCurrent: true }] }),
    fields: [
      { key: "studentNo", label: "Student no.", type: "string", path: ["student", "studentNo"] },
      { key: "program", label: "Programme", type: "string", path: ["student", "program", "code"] },
      { key: "course", label: "Course", type: "string", path: ["course", "code"] },
      { key: "term", label: "Term", type: "string", path: ["run", "term", "name"] },
      { key: "grade", label: "Grade", type: "string", path: ["grade"] },
      { key: "gradePoint", label: "Grade point", type: "number", path: ["gradePoint"] },
      { key: "percent", label: "Percent", type: "number", path: ["percent"] },
      { key: "credits", label: "Credits", type: "number", path: ["credits"] },
      { key: "status", label: "Result", type: "enum", path: ["status"], options: vals(CourseResultStatus) },
      { key: "published", label: "Published", type: "date", path: ["publishedAt"] },
    ],
  },
  {
    key: "employees", label: "Employees", description: "Staff records in your scope.", permission: "hr.view", model: "employee", personal: true,
    scope: (ctx) => employeeWhere(ctx),
    fields: [
      { key: "employeeNo", label: "Employee no.", type: "string", path: ["employeeNo"] },
      { key: "firstName", label: "First name", type: "string", path: ["firstName"] },
      { key: "lastName", label: "Last name", type: "string", path: ["lastName"] },
      { key: "department", label: "Department", type: "string", path: ["department", "code"] },
      { key: "designation", label: "Designation", type: "string", path: ["designation"] },
      { key: "category", label: "Category", type: "enum", path: ["category"], options: vals(EmployeeCategory) },
      { key: "employmentType", label: "Employment", type: "enum", path: ["employmentType"], options: vals(EmploymentType) },
      { key: "status", label: "Status", type: "enum", path: ["status"], options: vals(EmployeeStatus) },
      { key: "joinDate", label: "Joined", type: "date", path: ["joinDate"] },
    ],
  },
  {
    key: "publications", label: "Publications", description: "Research publications.", permission: "research.view", model: "publication", personal: false,
    scope: (ctx) => publicationWhere(ctx),
    fields: [
      { key: "title", label: "Title", type: "string", path: ["title"] },
      { key: "type", label: "Type", type: "enum", path: ["type"], options: vals(PublicationType) },
      { key: "year", label: "Year", type: "number", path: ["year"] },
      { key: "venue", label: "Venue", type: "string", path: ["venue"] },
      { key: "indexing", label: "Indexing", type: "enum", path: ["indexing"], options: vals(Indexing) },
      { key: "impactFactor", label: "Impact factor", type: "number", path: ["impactFactor"] },
      { key: "department", label: "Department", type: "string", path: ["department", "code"] },
      { key: "verified", label: "Verified on", type: "date", path: ["verifiedAt"] },
    ],
  },
  {
    key: "tickets", label: "Helpdesk tickets", description: "Tickets with SLA outcome.", permission: "helpdesk.agent", model: "ticket", personal: false,
    scope: () => ({}),
    fields: [
      { key: "number", label: "Ticket no.", type: "string", path: ["number"] },
      { key: "category", label: "Category", type: "string", path: ["category"] },
      { key: "priority", label: "Priority", type: "enum", path: ["priority"], options: vals(TicketPriority) },
      { key: "status", label: "Status", type: "enum", path: ["status"], options: vals(TicketStatus) },
      { key: "createdAt", label: "Raised", type: "date", path: ["createdAt"] },
      { key: "resolvedAt", label: "Resolved", type: "date", path: ["resolvedAt"] },
      { key: "satisfaction", label: "Rating", type: "number", path: ["satisfaction"] },
      { key: "onTime", label: "Resolved within SLA", type: "string", compute: { deps: [["resolvedAt"], ["dueAt"]], fn: (r) => (r.resolvedAt ? ((r.resolvedAt as Date) <= (r.dueAt as Date) ? "yes" : "no") : null) } },
      { key: "hoursToResolve", label: "Hours to resolve", type: "number", compute: { deps: [["resolvedAt"], ["createdAt"]], fn: (r) => (r.resolvedAt ? Math.round((((r.resolvedAt as Date).getTime() - (r.createdAt as Date).getTime()) / 3_600_000) * 10) / 10 : null) } },
    ],
  },
  {
    key: "libraryLoans", label: "Library loans", description: "Circulation with fines.", permission: "library.circulate", model: "libraryLoan", personal: false,
    scope: () => ({}),
    fields: [
      { key: "accessionNo", label: "Accession no.", type: "string", path: ["copy", "accessionNo"] },
      { key: "title", label: "Title", type: "string", path: ["copy", "item", "title"] },
      { key: "subject", label: "Subject", type: "string", path: ["copy", "item", "subject"] },
      { key: "borrowerType", label: "Borrower type", type: "string", compute: { deps: [["studentId"]], fn: (r) => (r.studentId ? "student" : "staff") } },
      { key: "issuedAt", label: "Issued", type: "date", path: ["issuedAt"] },
      { key: "dueAt", label: "Due", type: "date", path: ["dueAt"] },
      { key: "returnedAt", label: "Returned", type: "date", path: ["returnedAt"] },
      { key: "fine", label: "Fine", type: "money", path: ["fineAmount"] },
    ],
  },
  {
    key: "applications", label: "Admission applications", description: "Applications by programme and status.", permission: "admission.view", model: "admissionApplication", personal: true,
    scope: () => ({}),
    fields: [
      { key: "number", label: "Application no.", type: "string", path: ["number"] },
      { key: "cycle", label: "Cycle", type: "string", path: ["cycle", "name"] },
      { key: "program", label: "Programme", type: "string", path: ["program", "code"] },
      { key: "status", label: "Status", type: "enum", path: ["status"], options: vals(ApplicantStatus) },
      { key: "category", label: "Category", type: "string", path: ["category"] },
      { key: "gender", label: "Gender", type: "enum", path: ["gender"], options: vals(Gender) },
      { key: "qualifyingPercent", label: "Qualifying %", type: "number", path: ["qualifyingPercent"] },
      { key: "meritScore", label: "Merit score", type: "number", path: ["meritScore"] },
      { key: "createdAt", label: "Applied on", type: "date", path: ["createdAt"] },
    ],
  },
  {
    key: "placements", label: "Placement applications", description: "Drive applications and offers.", permission: "placement.manage", model: "placementApplication", personal: true,
    scope: () => ({}),
    fields: [
      { key: "company", label: "Company", type: "string", path: ["drive", "company", "name"] },
      { key: "role", label: "Role", type: "string", path: ["drive", "role"] },
      { key: "studentNo", label: "Student no.", type: "string", path: ["student", "studentNo"] },
      { key: "program", label: "Programme", type: "string", path: ["student", "program", "code"] },
      { key: "admissionYear", label: "Admission year", type: "number", path: ["student", "batch", "admissionYear"] },
      { key: "status", label: "Status", type: "enum", path: ["status"], options: vals(PlacementStatus) },
      { key: "offerCtc", label: "Offer (CTC)", type: "money", path: ["offerCtc"] },
    ],
  },
];

export const datasetByKey = (k: string) => DATASETS.find((d) => d.key === k);
export { get as readPath, num as toNumber };
export type WhereOf = Prisma.StudentWhereInput;
