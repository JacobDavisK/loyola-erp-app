import type { FormField } from "@/components/app/form-dialog";

type Opt = { id: string; label: string };
const opts = (xs: Opt[]) => xs.map((x) => ({ value: x.id, label: x.label }));

export const vendorFields: FormField[] = [
  { name: "name", label: "Name", type: "text", wide: true },
  { name: "gstin", label: "GSTIN", type: "text", optional: true, upper: true },
  { name: "contactName", label: "Contact person", type: "text", optional: true },
  { name: "phone", label: "Phone", type: "text", optional: true },
  { name: "email", label: "Email", type: "email", optional: true },
  { name: "categories", label: "Supplies (comma-separated)", type: "text", optional: true, wide: true, placeholder: "IT, stationery, lab consumables" },
  { name: "address", label: "Address", type: "textarea", optional: true },
  { name: "active", label: "Active", type: "checkbox" },
];

export const billFields: FormField[] = [
  { name: "invoiceNo", label: "Vendor bill number", type: "text" },
  { name: "invoiceDate", label: "Bill date", type: "date" },
  { name: "amount", label: "Amount (incl. GST)", type: "number", min: 0, step: 0.01 },
];

export const budgetFields = (departments: Opt[]): FormField[] => [
  { name: "fiscalYear", label: "Financial year", type: "text", placeholder: "2026-27" },
  { name: "departmentId", label: "Department (blank = institution-wide)", type: "select", optional: true, options: opts(departments) },
  { name: "notes", label: "Notes", type: "textarea", optional: true },
];

export const budgetLineFields = (accounts: Opt[]): FormField[] => [
  { name: "accountId", label: "Ledger account", type: "select", options: opts(accounts) },
  { name: "amount", label: "Allocation (₹)", type: "number", min: 0, step: 1 },
  { name: "note", label: "Note", type: "text", optional: true },
];

export const storeFields = (staff: Opt[]): FormField[] => [
  { name: "name", label: "Name", type: "text" },
  { name: "location", label: "Location", type: "text", optional: true },
  { name: "keeperId", label: "Store keeper", type: "select", optional: true, options: opts(staff) },
];

export const itemFields: FormField[] = [
  { name: "code", label: "Code", type: "text", upper: true },
  { name: "name", label: "Name", type: "text" },
  { name: "unit", label: "Unit", type: "text", placeholder: "nos, ream, box, litre" },
  { name: "category", label: "Category", type: "text", placeholder: "Stationery" },
  { name: "reorderLevel", label: "Reorder level", type: "number", min: 0 },
  { name: "active", label: "Active", type: "checkbox" },
];

export const issueFields = (items: Opt[], stores: Opt[], departments: Opt[]): FormField[] => [
  { name: "itemId", label: "Item", type: "select", options: opts(items) },
  { name: "storeId", label: "From store", type: "select", options: opts(stores) },
  { name: "quantity", label: "Quantity", type: "number", min: 0, step: 0.001 },
  { name: "departmentId", label: "To department", type: "select", options: opts(departments) },
  { name: "note", label: "Indent / note", type: "text", optional: true },
];

export const transferFields = (items: Opt[], stores: Opt[]): FormField[] => [
  { name: "itemId", label: "Item", type: "select", options: opts(items) },
  { name: "fromStoreId", label: "From store", type: "select", options: opts(stores) },
  { name: "toStoreId", label: "To store", type: "select", options: opts(stores) },
  { name: "quantity", label: "Quantity", type: "number", min: 0, step: 0.001 },
];

export const countFields = (items: Opt[], stores: Opt[]): FormField[] => [
  { name: "itemId", label: "Item", type: "select", options: opts(items) },
  { name: "storeId", label: "Store", type: "select", options: opts(stores) },
  { name: "counted", label: "Quantity counted", type: "number", min: 0, step: 0.001 },
  { name: "note", label: "Count reference / reason for difference", type: "text" },
];

export const assetFields = (departments: Opt[]): FormField[] => [
  { name: "name", label: "Name", type: "text", wide: true },
  { name: "category", label: "Category", type: "text" },
  { name: "departmentId", label: "Department", type: "select", options: opts(departments) },
  { name: "location", label: "Location", type: "text", optional: true },
  { name: "serialNo", label: "Serial number", type: "text", optional: true },
  { name: "purchaseDate", label: "Purchased on", type: "date" },
  { name: "cost", label: "Cost (₹)", type: "number", min: 0, step: 0.01 },
  { name: "salvageValue", label: "Salvage value (₹)", type: "number", min: 0, step: 0.01 },
  { name: "usefulLifeYears", label: "Useful life (years)", type: "number", min: 1, step: 0.5 },
  { name: "method", label: "Depreciation", type: "select", options: [{ value: "STRAIGHT_LINE", label: "Straight line" }, { value: "WRITTEN_DOWN_VALUE", label: "Written-down value" }] },
  { name: "wdvRate", label: "WDV rate % (if written-down value)", type: "number", optional: true, min: 0, max: 99, step: 0.5 },
];

export const assetTransferFields = (departments: Opt[]): FormField[] => [
  { name: "departmentId", label: "To department", type: "select", options: opts(departments) },
  { name: "location", label: "New location", type: "text", optional: true },
  { name: "note", label: "Note", type: "text", optional: true },
];

export const assetEventFields: FormField[] = [
  { name: "kind", label: "Event", type: "select", options: [{ value: "VERIFIED", label: "Physically verified" }, { value: "REPAIR", label: "Sent for repair" }, { value: "RETURNED_TO_USE", label: "Back in use" }, { value: "IDLE", label: "Idle / not in use" }, { value: "LOST", label: "Missing" }] },
  { name: "note", label: "Note", type: "textarea" },
];

export const disposeFields: FormField[] = [
  { name: "date", label: "Disposed on", type: "date" },
  { name: "value", label: "Amount realised (₹)", type: "number", min: 0, step: 0.01 },
  { name: "note", label: "Authority and mode (auction, scrap, buy-back)", type: "textarea" },
];

export const bookingFields = (rooms: Opt[]): FormField[] => [
  { name: "roomId", label: "Room", type: "select", options: opts(rooms), wide: true },
  { name: "title", label: "Event / meeting", type: "text", wide: true },
  { name: "startsAt", label: "From", type: "datetime-local" },
  { name: "endsAt", label: "To", type: "datetime-local" },
  { name: "attendees", label: "Expected attendees", type: "number", optional: true, min: 1 },
  { name: "purpose", label: "Details (AV, seating, catering)", type: "textarea", optional: true },
];

export const preRegisterFields: FormField[] = [
  { name: "name", label: "Visitor's name", type: "text" },
  { name: "phone", label: "Phone", type: "text" },
  { name: "purpose", label: "Purpose", type: "text", wide: true },
  { name: "expectedAt", label: "Expected at", type: "datetime-local" },
  { name: "vehicleNo", label: "Vehicle number", type: "text", optional: true, upper: true },
];

export const walkInFields = (staff: Opt[]): FormField[] => [
  { name: "name", label: "Visitor's name", type: "text" },
  { name: "phone", label: "Phone", type: "text" },
  { name: "purpose", label: "Purpose", type: "text", wide: true },
  { name: "hostUserId", label: "To see (staff member)", type: "select", optional: true, options: opts(staff) },
  { name: "hostName", label: "Or: whom / which office", type: "text", optional: true },
  { name: "idProof", label: "ID shown (type and last 4 digits)", type: "text", optional: true },
  { name: "vehicleNo", label: "Vehicle number", type: "text", optional: true, upper: true },
];

export const passCodeFields: FormField[] = [{ name: "passCode", label: "Six-digit pass code", type: "text" }];

export const outpassFields: FormField[] = [
  { name: "destination", label: "Going to", type: "text", wide: true },
  { name: "reason", label: "Reason", type: "textarea" },
  { name: "leaveAt", label: "Leaving", type: "datetime-local" },
  { name: "returnBy", label: "Returning by", type: "datetime-local" },
];

export const clinicFields: FormField[] = [
  { name: "patient", label: "Patient", type: "select", options: [{ value: "STUDENT", label: "Student" }, { value: "EMPLOYEE", label: "Staff member" }] },
  { name: "rollOrCode", label: "Student / employee number", type: "text", upper: true },
  { name: "complaint", label: "Complaint", type: "textarea" },
  { name: "temperature", label: "Temperature (°C)", type: "number", optional: true, step: 0.1 },
  { name: "pulse", label: "Pulse", type: "number", optional: true },
  { name: "bp", label: "Blood pressure (e.g. 120/80)", type: "text", optional: true },
  { name: "diagnosis", label: "Diagnosis", type: "text", optional: true, wide: true },
  { name: "treatment", label: "Treatment given", type: "textarea", optional: true },
  { name: "prescription", label: "Prescription", type: "textarea", optional: true },
  { name: "referral", label: "Referred to", type: "text", optional: true },
  { name: "restDays", label: "Rest advised (days)", type: "number", min: 0, max: 30 },
  { name: "certificate", label: "Issue a medical certificate", type: "checkbox" },
];
