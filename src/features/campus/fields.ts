import type { FormField } from "@/components/app/form-dialog";

export const ITEM_FIELDS: FormField[] = [
  { name: "title", label: "Title", type: "text", wide: true },
  { name: "authors", label: "Authors", type: "text", wide: true },
  { name: "isbn", label: "ISBN", type: "text", optional: true },
  { name: "year", label: "Year", type: "number", optional: true },
  { name: "publisher", label: "Publisher", type: "text", optional: true },
  { name: "edition", label: "Edition", type: "text", optional: true },
  { name: "subject", label: "Subject", type: "text", optional: true },
  { name: "callNo", label: "Call number", type: "text", optional: true },
];


export function driveFields(companies: { id: string; name: string }[]): FormField[] {
  return [
    { name: "companyId", label: "Company", type: "select", options: companies.map((c) => ({ value: c.id, label: c.name })) },
    { name: "status", label: "Status", type: "select", options: [{ value: "DRAFT", label: "Draft" }, { value: "OPEN", label: "Open for applications" }, { value: "CLOSED", label: "Closed" }, { value: "COMPLETED", label: "Completed" }] },
    { name: "title", label: "Title", type: "text", wide: true },
    { name: "role", label: "Role", type: "text" },
    { name: "ctc", label: "CTC (annual)", type: "number", min: 0 },
    { name: "location", label: "Location", type: "text", optional: true },
    { name: "applyBy", label: "Apply by", type: "datetime-local" },
    { name: "driveDate", label: "Drive date", type: "datetime-local", optional: true },
    { name: "minCgpa", label: "Minimum CGPA", type: "number", optional: true, step: 0.1 },
    { name: "maxActiveBacklogs", label: "Maximum active backlogs", type: "number", optional: true, min: 0 },
    { name: "programCodes", label: "Programmes (codes)", type: "text", optional: true, placeholder: "BCA, BCOM" },
    { name: "batchYears", label: "Admission years", type: "text", optional: true, placeholder: "2024" },
    { name: "description", label: "Description", type: "textarea" },
  ];
}
