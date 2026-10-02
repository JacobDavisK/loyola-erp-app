import type { FormField } from "@/components/app/form-dialog";

export function eventFields(clubs: { id: string; name: string }[], badges: { id: string; name: string }[]): FormField[] {
  return [
    { name: "title", label: "Title", type: "text", wide: true },
    { name: "clubId", label: "Organised by", type: "select", optional: true, options: clubs.map((c) => ({ value: c.id, label: c.name })) },
    { name: "venue", label: "Venue", type: "text" },
    { name: "startsAt", label: "Starts", type: "datetime-local" },
    { name: "endsAt", label: "Ends", type: "datetime-local" },
    { name: "capacity", label: "Capacity", type: "number", optional: true, min: 1 },
    { name: "registrationCloses", label: "Registration closes", type: "datetime-local", optional: true },
    { name: "hours", label: "Activity hours credited (NSS / NCC)", type: "number", optional: true, step: 0.5 },
    { name: "badgeId", label: "Participation badge", type: "select", optional: true, options: badges.map((b) => ({ value: b.id, label: b.name })) },
    { name: "status", label: "Status", type: "select", options: [{ value: "DRAFT", label: "Draft" }, { value: "PUBLISHED", label: "Published (open for registration)" }] },
    { name: "description", label: "Description", type: "textarea" },
  ];
}

export function clubFields(staff: { id: string; name: string }[]): FormField[] {
  return [
    { name: "name", label: "Name", type: "text", wide: true },
    { name: "kind", label: "Kind", type: "select", options: [{ value: "CLUB", label: "Club" }, { value: "NSS", label: "NSS unit" }, { value: "NCC", label: "NCC unit" }, { value: "SPORTS", label: "Sports team" }, { value: "CULTURAL", label: "Cultural" }, { value: "PROFESSIONAL", label: "Professional society" }] },
    { name: "coordinatorId", label: "Faculty coordinator", type: "select", options: staff.map((s) => ({ value: s.id, label: s.name })) },
    { name: "description", label: "Description", type: "textarea" },
    { name: "active", label: "Active", type: "checkbox" },
  ];
}
