"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requestAccessAction, revokeDelegationAction, saveDelegationAction } from "@/features/workflow/actions";
import { StaffPicker, type StaffOption } from "@/features/workflow/staff-picker";

const field = "h-9 w-full rounded-lg border bg-card px-2.5 text-sm";

export function DelegationForm() {
  const router = useRouter();
  const [to, setTo] = useState<StaffOption | null>(null);
  const [startsAt, setStartsAt] = useState(new Date().toISOString().slice(0, 10));
  const [endsAt, setEndsAt] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveDelegationAction(null, { toUserId: to?.id ?? "", startsAt, endsAt: endsAt ? `${endsAt}T23:59:59` : "", reason: reason || null });
          if (!r.ok) {
            toast.error(r.error, { description: r.fieldErrors ? Object.values(r.fieldErrors).flat().join(" · ") : undefined });
            return;
          }
          toast.success("Delegation saved");
          setTo(null);
          setEndsAt("");
          setReason("");
          router.refresh();
        });
      }}
    >
      <div className="sm:col-span-2"><StaffPicker value={to} onChange={setTo} label="Delegate my approvals to" /></div>
      <div className="space-y-1.5"><Label htmlFor="d-from">From</Label><Input id="d-from" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required /></div>
      <div className="space-y-1.5"><Label htmlFor="d-to">Until</Label><Input id="d-to" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required /></div>
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="d-reason">Reason (optional)</Label><Input id="d-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Conference travel" /></div>
      <div className="sm:col-span-2"><Button type="submit" disabled={!to || !endsAt || pending}>{pending && <Loader2 className="animate-spin" />} Save delegation</Button></div>
    </form>
  );
}

export function EndDelegationButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await revokeDelegationAction(id);
          if (!r.ok) toast.error(r.error);
          else router.refresh();
        })
      }
    >
      End now
    </Button>
  );
}

type Opt = { id: string; label: string };

export function AccessRequestForm({ roles, departments, units, campuses, ownDepartmentId }: { roles: (Opt & { isGlobal: boolean; description: string | null })[]; departments: Opt[]; units: Opt[]; campuses: Opt[]; ownDepartmentId: string | null }) {
  const router = useRouter();
  const [roleId, setRoleId] = useState("");
  const [scopeType, setScopeType] = useState<"department" | "unit" | "campus">("department");
  const [scopeId, setScopeId] = useState(ownDepartmentId ?? "");
  const [validUntil, setValidUntil] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const role = roles.find((r) => r.id === roleId);
  const options = scopeType === "department" ? departments : scopeType === "unit" ? units : campuses;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await requestAccessAction(null, { roleId, scopeType: role?.isGlobal ? "global" : scopeType, scopeId: scopeId || null, validUntil: validUntil || null, reason });
          if (!r.ok) {
            toast.error(r.error, { description: r.fieldErrors ? Object.values(r.fieldErrors).flat().join(" · ") : undefined });
            return;
          }
          toast.success(r.data.status === "APPROVED" ? "Access granted" : "Request submitted for approval");
          router.push(`/inbox/requests/${r.data.id}`);
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="ar-role">Role</Label>
        <select id="ar-role" className={field} value={roleId} onChange={(e) => setRoleId(e.target.value)} required>
          <option value="">Choose a role…</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.label}{r.isGlobal ? " (institution-wide)" : ""}</option>)}
        </select>
        {role?.description && <p className="text-xs text-muted-foreground">{role.description}</p>}
      </div>
      {role && !role.isGlobal && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ar-scope-type">For</Label>
            <select id="ar-scope-type" className={field} value={scopeType} onChange={(e) => { setScopeType(e.target.value as typeof scopeType); setScopeId(""); }}>
              <option value="department">A department</option>
              <option value="unit">A faculty / school</option>
              <option value="campus">A campus</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ar-scope">Which</Label>
            <select id="ar-scope" className={field} value={scopeId} onChange={(e) => setScopeId(e.target.value)} required>
              <option value="">Choose…</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="ar-until">Needed until (optional)</Label>
        <Input id="ar-until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="max-w-xs" />
        <p className="text-xs text-muted-foreground">Temporary access expires automatically. Leave empty for a permanent change.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ar-reason">Why do you need it?</Label>
        <Textarea id="ar-reason" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={10} />
      </div>
      <Button type="submit" disabled={pending || !roleId || reason.trim().length < 10}>{pending ? <Loader2 className="animate-spin" /> : <Send />} Submit request</Button>
    </form>
  );
}
