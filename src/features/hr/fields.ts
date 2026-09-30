import type { FormField } from "@/components/app/form-dialog";
import { EMPLOYMENT_TYPE_LABEL } from "@/lib/domain/labels";

/** Field definitions shared by the create and edit employee dialogs. */
export function employeeFields(o: {
  departments: { id: string; name: string }[];
  positions: { id: string; code: string; title: string }[];
  managers: { id: string; firstName: string; lastName: string; employeeNo: string }[];
  users: { id: string; name: string; email: string }[];
}): FormField[] {
  return [
    { name: "firstName", label: "First name", type: "text" },
    { name: "lastName", label: "Last name", type: "text" },
    { name: "email", label: "Official e-mail", type: "email" },
    { name: "phone", label: "Phone", type: "text", optional: true },
    { name: "designation", label: "Designation", type: "text" },
    { name: "category", label: "Category", type: "select", options: [{ value: "TEACHING", label: "Teaching" }, { value: "NON_TEACHING", label: "Non-teaching" }] },
    { name: "employmentType", label: "Employment type", type: "select", options: Object.entries(EMPLOYMENT_TYPE_LABEL).map(([value, label]) => ({ value, label })) },
    { name: "departmentId", label: "Department", type: "select", optional: true, options: o.departments.map((d) => ({ value: d.id, label: d.name })) },
    { name: "positionId", label: "Sanctioned position", type: "select", optional: true, options: o.positions.map((p) => ({ value: p.id, label: `${p.code} — ${p.title}` })) },
    { name: "reportingToId", label: "Reports to", type: "select", optional: true, options: o.managers.map((m) => ({ value: m.id, label: `${m.firstName} ${m.lastName} (${m.employeeNo})` })) },
    { name: "joinDate", label: "Date of joining", type: "date" },
    { name: "confirmationDate", label: "Confirmation date", type: "date", optional: true },
    { name: "dateOfBirth", label: "Date of birth", type: "date", optional: true },
    { name: "gender", label: "Gender", type: "select", optional: true, options: [{ value: "FEMALE", label: "Female" }, { value: "MALE", label: "Male" }, { value: "OTHER", label: "Other" }, { value: "UNDISCLOSED", label: "Prefer not to say" }] },
    { name: "userId", label: "Linked user account", type: "select", optional: true, options: o.users.map((u) => ({ value: u.id, label: `${u.name} <${u.email}>` })), hint: "Links self-service leave and payslips to this sign-in." },
    { name: "specialization", label: "Specialisation", type: "text", optional: true },
  ];
}
