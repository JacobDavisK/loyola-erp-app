import type { FormField } from "@/components/app/form-dialog";

export function leaveFields(types: { id: string; code: string; name: string; paid: boolean; allowHalfDay: boolean }[]): FormField[] {
  return [
    { name: "leaveTypeId", label: "Leave type", type: "select", wide: true, options: types.map((t) => ({ value: t.id, label: `${t.name} (${t.code})${t.paid ? "" : " — unpaid"}` })) },
    { name: "fromDate", label: "From", type: "date" },
    { name: "toDate", label: "To", type: "date" },
    { name: "halfDay", label: "Half day", type: "select", optional: true, options: [{ value: "FIRST_HALF", label: "First half" }, { value: "SECOND_HALF", label: "Second half" }], hint: "Only for a single day." },
    { name: "contact", label: "Contact while away", type: "text", optional: true },
    { name: "reason", label: "Reason", type: "textarea" },
  ];
}
