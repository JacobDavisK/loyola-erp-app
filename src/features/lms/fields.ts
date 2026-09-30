import type { FormField } from "@/components/app/form-dialog";

export const MODULE_FIELDS: FormField[] = [
  { name: "title", label: "Title", type: "text", wide: true },
  { name: "description", label: "Description", type: "textarea", optional: true },
  { name: "order", label: "Order", type: "number", min: 0 },
  { name: "isPublished", label: "Visible to students", type: "checkbox" },
];

export const ITEM_FIELDS: FormField[] = [
  { name: "kind", label: "Type", type: "select", options: [{ value: "PAGE", label: "Page (text)" }, { value: "LINK", label: "Web link" }, { value: "VIDEO", label: "Video link" }] },
  { name: "title", label: "Title", type: "text" },
  { name: "url", label: "Link (for links and videos)", type: "text", optional: true, placeholder: "https://", wide: true },
  { name: "body", label: "Content / description", type: "textarea", optional: true },
  { name: "order", label: "Order", type: "number", min: 0 },
  { name: "availableFrom", label: "Available from", type: "datetime-local", optional: true },
  { name: "isPublished", label: "Visible to students", type: "checkbox" },
];

export const ANNOUNCEMENT_FIELDS: FormField[] = [
  { name: "title", label: "Title", type: "text", wide: true },
  { name: "body", label: "Message", type: "textarea" },
];

export function assignmentFields(modules: { id: string; title: string }[]): FormField[] {
  return [
    { name: "title", label: "Title", type: "text", wide: true },
    { name: "instructions", label: "Instructions", type: "textarea" },
    { name: "moduleId", label: "Module", type: "select", optional: true, options: modules.map((m) => ({ value: m.id, label: m.title })) },
    { name: "maxMarks", label: "Maximum marks", type: "number", min: 1, step: 0.5 },
    { name: "dueAt", label: "Due", type: "datetime-local" },
    { name: "closesAt", label: "Accept late work until", type: "datetime-local", optional: true, hint: "Leave empty to refuse late work." },
    { name: "latePenaltyPercent", label: "Late penalty %", type: "number", min: 0, max: 100 },
    { name: "maxAttempts", label: "Attempts allowed", type: "number", min: 1, max: 20 },
    { name: "maxFiles", label: "Files per attempt", type: "number", min: 0, max: 10 },
    { name: "allowText", label: "Allow a typed answer", type: "checkbox" },
    { name: "allowFiles", label: "Allow file uploads", type: "checkbox" },
    { name: "isPublished", label: "Published (students are notified the first time)", type: "checkbox", wide: true },
  ];
}

export function quizFields(modules: { id: string; title: string }[]): FormField[] {
  return [
    { name: "title", label: "Title", type: "text", wide: true },
    { name: "instructions", label: "Instructions", type: "textarea", optional: true },
    { name: "moduleId", label: "Module", type: "select", optional: true, options: modules.map((m) => ({ value: m.id, label: m.title })) },
    { name: "opensAt", label: "Opens", type: "datetime-local" },
    { name: "closesAt", label: "Closes", type: "datetime-local" },
    { name: "timeLimitMinutes", label: "Time limit (minutes)", type: "number", optional: true, min: 1 },
    { name: "maxAttempts", label: "Attempts allowed", type: "number", min: 1, max: 20 },
    { name: "reviewPolicy", label: "Students see", type: "select", options: [{ value: "AFTER_CLOSE", label: "Score and answers after the quiz closes" }, { value: "AFTER_SUBMIT", label: "Score and answers right after submitting" }, { value: "SCORE_ONLY", label: "Score only" }, { value: "NEVER", label: "Nothing" }] },
    { name: "shuffleQuestions", label: "Shuffle question order per student", type: "checkbox" },
    { name: "isPublished", label: "Published", type: "checkbox" },
  ];
}
