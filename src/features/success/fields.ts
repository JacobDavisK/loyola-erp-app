import type { FormField } from "@/components/app/form-dialog";

export const MEETING_FIELDS: FormField[] = [
  { name: "heldOn", label: "Held on", type: "datetime-local" },
  { name: "mode", label: "Mode", type: "select", options: [{ value: "IN_PERSON", label: "In person" }, { value: "ONLINE", label: "Online" }, { value: "PHONE", label: "Phone" }] },
  { name: "summary", label: "Summary (shared with the student)", type: "textarea" },
  { name: "actionItems", label: "Action items, one per line (shared)", type: "textarea", optional: true },
  { name: "privateNotes", label: "Private notes (only you and success managers)", type: "textarea", optional: true },
  { name: "followUpOn", label: "Follow up on", type: "date", optional: true },
];

export const CASE_FIELDS: FormField[] = [
  { name: "summary", label: "What is the concern?", type: "text", wide: true },
  { name: "level", label: "How urgent", type: "select", options: [{ value: "LOW", label: "Low" }, { value: "MEDIUM", label: "Medium" }, { value: "HIGH", label: "High" }] },
  { name: "details", label: "Details", type: "textarea", optional: true },
];

export const HELP_FIELDS: FormField[] = [
  { name: "summary", label: "What do you need help with?", type: "text", wide: true },
  { name: "details", label: "Tell us more (only your mentor and student support see this)", type: "textarea", optional: true },
];

export const ARTICLE_FIELDS: FormField[] = [
  { name: "title", label: "Title", type: "text", wide: true },
  { name: "category", label: "Category", type: "text", placeholder: "Examinations" },
  { name: "audience", label: "For", type: "select", options: [{ value: "ALL", label: "Everyone" }, { value: "STUDENT", label: "Students" }, { value: "STAFF", label: "Staff" }, { value: "GUARDIAN", label: "Guardians" }] },
  { name: "tags", label: "Tags (comma-separated)", type: "text", optional: true, wide: true },
  { name: "body", label: "Article", type: "textarea" },
  { name: "published", label: "Published", type: "checkbox" },
];
