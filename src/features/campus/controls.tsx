"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { BookCheck, BookUp, Loader2, Send, Star, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelPassAction, issueCopyAction, rateTicketAction, replyTicketAction, respondToOfferAction, returnCopyAction, submitApplicationAction, updatePlacementAction, uploadDocumentAction,
  verifyDocumentAction,
} from "@/features/campus/actions";
import { cn } from "@/lib/utils";

type R = { ok: true; data?: unknown; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
const field = "h-9 w-full rounded-lg border bg-card px-2.5 text-sm";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return {
    pending,
    run: (fn: () => Promise<R>, after?: (r: R & { ok: true }) => void) =>
      start(async () => {
        const r = await fn();
        if (!r.ok) {
          toast.error(r.error, { description: r.fieldErrors ? Object.entries(r.fieldErrors).map(([k, m]) => `${k}: ${m[0]}`).join(" · ") : undefined });
          return;
        }
        if (r.message) toast.success(r.message);
        after?.(r);
        router.refresh();
      }),
  };
}

/** Circulation desk: scan or type the accession number and the borrower's student/employee number. */
export function CirculationDesk({ canWaive }: { canWaive: boolean }) {
  const { pending, run } = useRun();
  const [acc, setAcc] = useState("");
  const [who, setWho] = useState("");
  const [ret, setRet] = useState("");
  const [waive, setWaive] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run(() => issueCopyAction({ accessionNo: acc, borrower: who }), (r) => { toast.success(`Due ${new Date((r.data as { dueAt: string }).dueAt).toLocaleDateString()}`); setAcc(""); }); }}>
        <h3 className="text-sm font-medium">Issue</h3>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1"><Label htmlFor="cd-who" className="text-xs">Student / employee no.</Label><Input id="cd-who" value={who} onChange={(e) => setWho(e.target.value.toUpperCase())} required /></div>
          <div className="space-y-1"><Label htmlFor="cd-acc" className="text-xs">Accession no.</Label><Input id="cd-acc" value={acc} onChange={(e) => setAcc(e.target.value.toUpperCase())} required /></div>
        </div>
        <Button size="sm" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <BookUp />} Issue</Button>
      </form>
      <form className="space-y-2" onSubmit={(e) => {
        e.preventDefault();
        run(() => returnCopyAction({ accessionNo: ret, waive, waiveReason: reason || null }), (r) => {
          const d = r.data as { fine: number; invoiceId: string | null };
          toast.success(d.fine ? `Returned — fine ${(d.fine / 100).toFixed(2)}${d.invoiceId ? " invoiced to the student" : " (collect at the desk)"}` : "Returned — no fine");
          setRet(""); setWaive(false); setReason("");
        });
      }}>
        <h3 className="text-sm font-medium">Return</h3>
        <div className="space-y-1"><Label htmlFor="cd-ret" className="text-xs">Accession no.</Label><Input id="cd-ret" value={ret} onChange={(e) => setRet(e.target.value.toUpperCase())} required /></div>
        {canWaive && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1.5"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={waive} onChange={(e) => setWaive(e.target.checked)} /> Waive fine</label>
            {waive && <Input aria-label="Reason for waiver" className="h-8 flex-1" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />}
          </div>
        )}
        <Button size="sm" variant="outline" disabled={pending}><BookCheck /> Receive</Button>
      </form>
    </div>
  );
}

export function TicketReply({ id, agent }: { id: string; agent: boolean }) {
  const { pending, run } = useRun();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  return (
    <div className="space-y-2">
      <Textarea aria-label="Reply" rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder={internal ? "Internal note (not visible to the requester)" : "Write a reply"} className={cn(internal && "border-tone-warning/50 bg-tone-warning/5")} />
      <div className="flex items-center gap-3">
        {agent && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note</label>}
        <Button size="sm" className="ml-auto" disabled={pending || body.trim().length < 2} onClick={() => run(() => replyTicketAction(id, { body, internal }), () => setBody(""))}>{pending ? <Loader2 className="animate-spin" /> : <Send />} Send</Button>
      </div>
    </div>
  );
}

export function RateTicket({ id }: { id: string }) {
  const { pending, run } = useRun();
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Rate the help you received">
      <span className="mr-2 text-sm">How did we do?</span>
      {[1, 2, 3, 4, 5].map((n) => <Button key={n} size="icon-sm" variant="ghost" aria-label={`${n} star${n > 1 ? "s" : ""}`} disabled={pending} onClick={() => run(() => rateTicketAction(id, n))}><Star /></Button>)}
    </div>
  );
}

export const DOC_TYPES: Record<string, string> = {
  MARKSHEET_10: "Class X mark sheet", MARKSHEET_12: "Class XII / qualifying mark sheet", TRANSFER_CERTIFICATE: "Transfer certificate", MIGRATION_CERTIFICATE: "Migration certificate",
  ID_PROOF: "Identity proof", CATEGORY_CERTIFICATE: "Category / community certificate", INCOME_CERTIFICATE: "Income certificate", PHOTO: "Photograph", OTHER: "Other",
};

export function DocumentUpload({ studentId }: { studentId: string }) {
  const { pending, run } = useRun();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => uploadDocumentAction(studentId, new FormData(ref.current!)), () => ref.current?.reset()); }}>
      <div className="space-y-1"><Label htmlFor="du-type" className="text-xs">Document</Label><select id="du-type" name="type" className={`${field} w-64`}>{Object.entries(DOC_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      <div className="space-y-1"><Label htmlFor="du-file" className="text-xs">File (PDF or image, max 5 MB)</Label><Input id="du-file" name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" required /></div>
      <Button size="sm" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Upload />} Upload</Button>
    </form>
  );
}

export function VerifyDocumentButtons({ id }: { id: string }) {
  const { pending, run } = useRun();
  return (
    <div className="flex gap-1">
      <Button size="xs" disabled={pending} onClick={() => run(() => verifyDocumentAction(id, { status: "VERIFIED" }))}>Verify</Button>
      <Button size="xs" variant="outline" disabled={pending} onClick={() => { const note = prompt("Why is this document not acceptable?"); if (note) run(() => verifyDocumentAction(id, { status: "REJECTED", note })); }}>Reject</Button>
    </div>
  );
}

export function CancelPassButton({ id }: { id: string }) {
  const { pending, run } = useRun();
  return <Button size="xs" variant="ghost" className="text-destructive" disabled={pending} onClick={() => { const r = prompt("Reason for cancelling this pass?"); if (r) run(() => cancelPassAction(id, r)); }}>Cancel</Button>;
}

export function PlacementStatusButtons({ id, ctc }: { id: string; ctc: number }) {
  const { pending, run } = useRun();
  return (
    <div className="flex gap-1">
      <Button size="xs" variant="outline" disabled={pending} onClick={() => run(() => updatePlacementAction(id, { status: "SHORTLISTED" }))}>Shortlist</Button>
      <Button size="xs" disabled={pending} onClick={() => { const v = prompt("Offered CTC (annual)?", String(ctc)); if (v) run(() => updatePlacementAction(id, { status: "SELECTED", offerCtc: Number(v) })); }}>Select</Button>
      <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => updatePlacementAction(id, { status: "REJECTED" }))}>Reject</Button>
    </div>
  );
}

// ───────────────────────── Public admission form ─────────────────────────

export function ApplicationForm({ cycles }: { cycles: { id: string; name: string; closesAt: string; programs: { id: string; name: string }[] }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [cycleId, setCycleId] = useState(cycles[0]?.id ?? "");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const ref = useRef<HTMLFormElement>(null);
  const cycle = cycles.find((c) => c.id === cycleId);
  const err = (k: string) => errors[k] && <p className="text-xs text-destructive">{errors[k][0]}</p>;
  return (
    <form ref={ref} className="space-y-4" noValidate onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(ref.current!);
      const payload = {
        cycleId, programId: f.get("programId"), firstName: f.get("firstName"), lastName: f.get("lastName"), email: f.get("email"), phone: f.get("phone"), dateOfBirth: f.get("dateOfBirth"),
        gender: f.get("gender") || null, category: f.get("category") || null, qualifyingExam: f.get("qualifyingExam"), qualifyingPercent: Number(f.get("qualifyingPercent")), declaration: f.get("declaration") === "on",
      };
      start(async () => {
        const r = await submitApplicationAction(payload);
        if (!r.ok) { setErrors(r.fieldErrors ?? {}); toast.error(r.error); return; }
        const d = r.data as { number: string; token: string };
        router.push(`/apply/status?n=${encodeURIComponent(d.number)}&t=${encodeURIComponent(d.token)}&new=1`);
      });
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="ap-cycle">Admission</Label><select id="ap-cycle" className={field} value={cycleId} onChange={(e) => setCycleId(e.target.value)}>{cycles.map((c) => <option key={c.id} value={c.id}>{c.name} (closes {new Date(c.closesAt).toLocaleDateString()})</option>)}</select></div>
        <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="ap-prog">Programme</Label><select id="ap-prog" name="programId" className={field}>{cycle?.programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>{err("programId")}</div>
        <div className="space-y-1.5"><Label htmlFor="ap-fn">First name</Label><Input id="ap-fn" name="firstName" autoComplete="given-name" required />{err("firstName")}</div>
        <div className="space-y-1.5"><Label htmlFor="ap-ln">Last name</Label><Input id="ap-ln" name="lastName" autoComplete="family-name" required />{err("lastName")}</div>
        <div className="space-y-1.5"><Label htmlFor="ap-em">E-mail</Label><Input id="ap-em" name="email" type="email" autoComplete="email" required />{err("email")}</div>
        <div className="space-y-1.5"><Label htmlFor="ap-ph">Phone</Label><Input id="ap-ph" name="phone" type="tel" autoComplete="tel" required />{err("phone")}</div>
        <div className="space-y-1.5"><Label htmlFor="ap-dob">Date of birth</Label><Input id="ap-dob" name="dateOfBirth" type="date" required />{err("dateOfBirth")}</div>
        <div className="space-y-1.5"><Label htmlFor="ap-g">Gender</Label><select id="ap-g" name="gender" className={field}><option value="">Prefer not to say</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="OTHER">Other</option></select></div>
        <div className="space-y-1.5"><Label htmlFor="ap-cat">Category (optional)</Label><Input id="ap-cat" name="category" placeholder="e.g. General, OBC, SC, ST" /></div>
        <div className="space-y-1.5"><Label htmlFor="ap-qe">Qualifying examination</Label><Input id="ap-qe" name="qualifyingExam" placeholder="e.g. CBSE Class XII" required />{err("qualifyingExam")}</div>
        <div className="space-y-1.5"><Label htmlFor="ap-qp">Qualifying percentage</Label><Input id="ap-qp" name="qualifyingPercent" type="number" min={0} max={100} step="0.01" required />{err("qualifyingPercent")}</div>
      </div>
      <label className="flex items-start gap-2 text-sm"><input name="declaration" type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" /> I confirm that the information is correct and understand that admission depends on verification of original documents.</label>
      {err("declaration")}
      <Button disabled={pending || !cycle}>{pending && <Loader2 className="animate-spin" />} Submit application</Button>
    </form>
  );
}

export function OfferResponse({ number, token }: { number: string; token: string }) {
  const { pending, run } = useRun();
  return (
    <div className="flex gap-2">
      <Button disabled={pending} onClick={() => { if (confirm("Accept the offer of admission?")) run(() => respondToOfferAction(number, token, true)); }}>Accept offer</Button>
      <Button variant="outline" disabled={pending} onClick={() => { if (confirm("Decline the offer? The seat will go to the next applicant.")) run(() => respondToOfferAction(number, token, false)); }}>Decline</Button>
    </div>
  );
}
