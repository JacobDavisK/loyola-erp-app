"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createStudentAction, updateStudentAction } from "@/features/students/actions";
import { cn } from "@/lib/utils";

export interface StudentFormValue {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
  nationality: string;
  category: string;
  bloodGroup: string;
  programId: string;
  batchId: string;
  section: string;
  specialization: string;
  currentSemester: number;
  admissionNo: string;
  registrationNo: string;
  admittedOn: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  emergencyName: string;
  emergencyRelation: string;
  emergencyPhone: string;
}

type Opt = { id: string; label: string };
const field = "h-9 w-full rounded-lg border bg-card px-2.5 text-sm";

export function StudentForm({ id, initial, programs, batches }: { id: string | null; initial: StudentFormValue; programs: Opt[]; batches: (Opt & { programId: string })[] }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();
  const set = (k: keyof StudentFormValue, val: string | number) => setV((x) => ({ ...x, [k]: val }));
  const err = (k: string) => errors[k]?.join(" ");

  const text = (k: keyof StudentFormValue, label: string, opts: { type?: string; required?: boolean; span?: boolean; disabled?: boolean; hint?: string } = {}) => (
    <div className={cn("space-y-1.5", opts.span && "md:col-span-2")}>
      <Label htmlFor={`st-${k}`}>{label}{!opts.required && <span className="font-normal text-muted-foreground"> (optional)</span>}</Label>
      <Input id={`st-${k}`} type={opts.type ?? "text"} value={String(v[k] ?? "")} disabled={opts.disabled} onChange={(e) => set(k, opts.type === "number" ? Number(e.target.value) : e.target.value)} required={opts.required} aria-invalid={!!err(k)} aria-describedby={err(k) ? `st-${k}-err` : undefined} />
      {opts.hint && <p className="text-xs text-muted-foreground">{opts.hint}</p>}
      {err(k) && <p id={`st-${k}-err`} className="text-xs text-destructive">{err(k)}</p>}
    </div>
  );

  return (
    <form
      className="space-y-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const payload = {
            firstName: v.firstName, lastName: v.lastName, email: v.email, phone: v.phone || null, dateOfBirth: v.dateOfBirth || null, gender: v.gender || null,
            nationality: v.nationality || null, category: v.category || null, bloodGroup: v.bloodGroup || null, programId: v.programId, batchId: v.batchId,
            section: v.section || null, specialization: v.specialization || null, currentSemester: v.currentSemester, admissionNo: v.admissionNo || null,
            registrationNo: v.registrationNo || null, admittedOn: v.admittedOn,
            address: { line1: v.line1, line2: v.line2, city: v.city, state: v.state, postalCode: v.postalCode, country: v.country },
            emergencyName: v.emergencyName || null, emergencyRelation: v.emergencyRelation || null, emergencyPhone: v.emergencyPhone || null,
          };
          const res = id ? await updateStudentAction(id, payload) : await createStudentAction(payload);
          if (!res.ok) {
            setErrors(res.fieldErrors ?? {});
            toast.error(res.error);
            return;
          }
          toast.success(res.message ?? "Saved");
          if (!id && res.data && typeof res.data === "object" && "id" in res.data) router.push(`/students/${(res.data as { id: string }).id}`);
          else router.push(`/students/${id}`);
          router.refresh();
        });
      }}
    >
      <section className="surface-card p-5">
        <h2 className="mb-4 text-sm font-semibold">Identity</h2>
        <div className="grid gap-4 md:grid-cols-4">
          {text("firstName", "First name", { required: true })}
          {text("lastName", "Last name", { required: true })}
          {text("dateOfBirth", "Date of birth", { type: "date" })}
          <div className="space-y-1.5">
            <Label htmlFor="st-gender">Gender <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <select id="st-gender" className={field} value={v.gender} onChange={(e) => set("gender", e.target.value)}>
              <option value="">Not recorded</option>
              <option value="FEMALE">Female</option>
              <option value="MALE">Male</option>
              <option value="OTHER">Other</option>
              <option value="UNDISCLOSED">Prefer not to say</option>
            </select>
          </div>
          {text("nationality", "Nationality")}
          {text("category", "Admission category", { hint: "Only where institutionally required" })}
          {text("bloodGroup", "Blood group")}
        </div>
      </section>

      <section className="surface-card p-5">
        <h2 className="mb-4 text-sm font-semibold">Programme</h2>
        <div className="grid gap-4 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="st-program">Programme</Label>
            <select id="st-program" className={field} value={v.programId} onChange={(e) => setV((x) => ({ ...x, programId: e.target.value, batchId: "" }))} required aria-invalid={!!err("programId")}>
              <option value="">Choose…</option>
              {programs.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            {err("programId") && <p className="text-xs text-destructive">{err("programId")}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st-batch">Batch</Label>
            <select id="st-batch" className={field} value={v.batchId} onChange={(e) => set("batchId", e.target.value)} required aria-invalid={!!err("batchId")}>
              <option value="">Choose…</option>
              {batches.filter((b) => b.programId === v.programId).map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
            {err("batchId") && <p className="text-xs text-destructive">{err("batchId")}</p>}
          </div>
          {text("currentSemester", "Current semester", { type: "number", required: true })}
          {text("section", "Section")}
          {text("specialization", "Specialisation", { span: true })}
          {text("admittedOn", "Admitted on", { type: "date", required: true })}
          {text("admissionNo", "Admission number", { disabled: !!id, hint: id ? "Fixed once issued" : "Leave empty to generate" })}
          {text("registrationNo", "University registration no.")}
        </div>
      </section>

      <section className="surface-card p-5">
        <h2 className="mb-4 text-sm font-semibold">Contact</h2>
        <div className="grid gap-4 md:grid-cols-4">
          {text("email", "E-mail", { type: "email", required: true, span: true })}
          {text("phone", "Phone")}
          <div />
          {text("line1", "Address line 1", { span: true })}
          {text("line2", "Address line 2", { span: true })}
          {text("city", "City")}
          {text("state", "State / region")}
          {text("postalCode", "Postal code")}
          {text("country", "Country")}
        </div>
      </section>

      <section className="surface-card p-5">
        <h2 className="mb-4 text-sm font-semibold">Emergency contact</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {text("emergencyName", "Name")}
          {text("emergencyRelation", "Relationship")}
          {text("emergencyPhone", "Phone")}
        </div>
      </section>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Save />} {id ? "Save changes" : "Create student"}</Button>
      </div>
    </form>
  );
}
