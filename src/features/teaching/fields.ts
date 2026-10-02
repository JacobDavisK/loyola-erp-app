import type { FormField } from "@/components/app/form-dialog";

export function toolFields(tools: { id: string; name: string }[]): FormField[] {
  return [
    { name: "toolId", label: "Tool", type: "select", options: tools.map((t) => ({ value: t.id, label: t.name })) },
    { name: "title", label: "Title shown to students", type: "text" },
    { name: "maxScore", label: "Maximum score (to receive grades)", type: "number", optional: true, min: 1 },
    { name: "custom", label: "Custom parameters (key=value, one per line)", type: "textarea", optional: true },
  ];
}
