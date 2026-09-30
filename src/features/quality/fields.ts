import type { FormField } from "@/components/app/form-dialog";
import { BUDGET_HEADS } from "@/lib/domain/quality";

export const HEAD_LABEL: Record<(typeof BUDGET_HEADS)[number], string> = {
  EQUIPMENT: "Equipment", CONSUMABLES: "Consumables", TRAVEL: "Travel", MANPOWER: "Manpower", CONTINGENCY: "Contingency", OVERHEAD: "Overhead",
};

export const budgetFields: FormField[] = BUDGET_HEADS.map((h) => ({ name: `budget_${h}`, label: HEAD_LABEL[h], type: "number" as const, optional: true, min: 0, step: 0.01 }));

export const PROJECT_FIELDS: FormField[] = [
  { name: "title", label: "Title", type: "text", wide: true },
  { name: "abstract", label: "Abstract", type: "textarea" },
  { name: "fundingAgency", label: "Funding agency", type: "text" },
  { name: "scheme", label: "Scheme", type: "text", optional: true },
  { name: "durationMonths", label: "Duration (months)", type: "number", min: 1, max: 120 },
  { name: "coPis", label: "Co-investigators (employee numbers)", type: "text", optional: true, placeholder: "EMP2201, EMP2202" },
  { name: "team", label: "Other team members (employee numbers)", type: "text", optional: true, wide: true },
  ...budgetFields,
];

export const SANCTION_FIELDS: FormField[] = [
  { name: "grantRef", label: "Sanction order / grant reference", type: "text", wide: true },
  { name: "startDate", label: "Start date", type: "date" },
  ...budgetFields,
];

export const EXPENSE_FIELDS: FormField[] = [
  { name: "head", label: "Budget head", type: "select", options: BUDGET_HEADS.map((h) => ({ value: h, label: HEAD_LABEL[h] })) },
  { name: "amount", label: "Amount (negative for a correction)", type: "number", step: 0.01 },
  { name: "date", label: "Date", type: "date" },
  { name: "voucherNo", label: "Voucher / bill no.", type: "text", optional: true },
  { name: "description", label: "Description", type: "textarea" },
];

export const PUBLICATION_TYPES = { JOURNAL: "Journal article", CONFERENCE: "Conference paper", BOOK: "Book", CHAPTER: "Book chapter", PATENT: "Patent" } as const;
export const INDEXING = { SCOPUS: "Scopus", WEB_OF_SCIENCE: "Web of Science", UGC_CARE: "UGC-CARE", PUBMED: "PubMed", OTHER: "Other", NONE: "Not indexed" } as const;

export function publicationFields(projects: { id: string; label: string }[]): FormField[] {
  return [
    { name: "type", label: "Type", type: "select", options: Object.entries(PUBLICATION_TYPES).map(([value, label]) => ({ value, label })) },
    { name: "year", label: "Year", type: "number", min: 1900, max: 2200 },
    { name: "title", label: "Title", type: "text", wide: true },
    { name: "venue", label: "Journal / conference / publisher", type: "text", wide: true },
    { name: "authorsText", label: "All authors, as published", type: "text", wide: true },
    { name: "coAuthors", label: "Other authors from this institution (employee numbers)", type: "text", optional: true, wide: true },
    { name: "doi", label: "DOI", type: "text", optional: true, placeholder: "10.xxxx/…" },
    { name: "indexing", label: "Indexed in", type: "select", options: Object.entries(INDEXING).map(([value, label]) => ({ value, label })) },
    { name: "volume", label: "Volume / issue", type: "text", optional: true },
    { name: "pages", label: "Pages", type: "text", optional: true },
    { name: "impactFactor", label: "Impact factor", type: "number", optional: true, step: 0.001 },
    { name: "isbn", label: "ISBN / patent no.", type: "text", optional: true },
    { name: "url", label: "Link", type: "text", optional: true, wide: true },
    { name: "projectId", label: "Output of project", type: "select", optional: true, options: projects.map((p) => ({ value: p.id, label: p.label })), wide: true },
  ];
}

export const PROJECT_STATUS = {
  DRAFT: { label: "Draft", tone: "neutral", icon: "pencil" },
  UNDER_REVIEW: { label: "Under review", tone: "progress", icon: "send" },
  APPROVED: { label: "Cleared for submission", tone: "info", icon: "stamp" },
  SANCTIONED: { label: "Running", tone: "success", icon: "check" },
  COMPLETED: { label: "Completed", tone: "locked", icon: "badge-check" },
  REJECTED: { label: "Not cleared", tone: "danger", icon: "circle-x" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral", icon: "ban" },
} as const;

export const RESPONSE_STATUS = {
  NOT_STARTED: { label: "Not started", tone: "neutral", icon: "circle-dot" },
  DRAFT: { label: "In progress", tone: "info", icon: "pencil" },
  SUBMITTED: { label: "Submitted", tone: "progress", icon: "send" },
  APPROVED: { label: "Approved", tone: "success", icon: "check" },
  RETURNED: { label: "Returned", tone: "warning", icon: "undo-2" },
} as const;
