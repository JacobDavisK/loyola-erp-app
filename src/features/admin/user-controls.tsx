"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { grantRoleAction, revokeRoleAction, userSecurityActionAction } from "@/features/admin/actions";

type Op = "suspend" | "activate" | "unlock" | "reset-mfa" | "resend-invite" | "sign-out";

const LABEL: Record<Op, string> = {
  suspend: "Suspend account",
  activate: "Reactivate account",
  unlock: "Unlock account",
  "reset-mfa": "Reset two-step verification",
  "resend-invite": "Send password-set link",
  "sign-out": "Sign out all devices",
};

export function SecurityButtons({ userId, ops }: { userId: string; ops: Op[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap gap-2">
      {ops.map((op) => (
        <Button
          key={op}
          size="sm"
          variant={op === "suspend" ? "destructive" : "outline"}
          disabled={pending}
          onClick={() => {
            if (!confirm(`${LABEL[op]}?`)) return;
            start(async () => {
              const r = await userSecurityActionAction(userId, op);
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              toast.success(`${LABEL[op]}: done`);
              router.refresh();
            });
          }}
        >
          {LABEL[op]}
        </Button>
      ))}
    </div>
  );
}

type ScopeType = "own" | "department" | "unit" | "campus";
type Opt = { id: string; label: string };

export function RoleGrants({
  userId,
  grants,
  roles,
  departments,
  units,
  campuses,
}: {
  userId: string;
  grants: { id: string; role: string; scope: string | null; validUntil: string | null }[];
  roles: { id: string; name: string; isGlobal: boolean }[];
  departments: Opt[];
  units: Opt[];
  campuses: Opt[];
}) {
  const router = useRouter();
  const [roleId, setRoleId] = useState("");
  const [scopeType, setScopeType] = useState<ScopeType>("own");
  const [scopeId, setScopeId] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [pending, start] = useTransition();
  const role = roles.find((r) => r.id === roleId);
  const scopeOptions = scopeType === "department" ? departments : scopeType === "unit" ? units : scopeType === "campus" ? campuses : [];
  return (
    <div className="space-y-4">
      <ul className="flex flex-wrap gap-2">
        {grants.map((g) => (
          <li key={g.id} className="flex items-center gap-1.5 rounded-full border bg-card py-1 pr-1 pl-3 text-sm">
            {g.role}
            {g.scope && <span className="text-muted-foreground">· {g.scope}</span>}
            {g.validUntil && <span className="text-xs text-tone-warning">· until {g.validUntil}</span>}
            <button
              type="button"
              aria-label={`Revoke ${g.role}`}
              className="grid size-5 place-items-center rounded-full hover:bg-destructive/10 hover:text-destructive"
              disabled={pending}
              onClick={() => {
                if (!confirm(`Revoke ${g.role}?`)) return;
                start(async () => {
                  const r = await revokeRoleAction(g.id);
                  if (!r.ok) {
                    toast.error(r.error);
                    return;
                  }
                  toast.success("Role revoked");
                  router.refresh();
                });
              }}
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await grantRoleAction(userId, roleId, { type: role?.isGlobal ? "own" : scopeType, id: scopeId || null, validUntil: validUntil || null });
            if (!r.ok) {
              toast.error(r.error);
              return;
            }
            toast.success("Role granted");
            setRoleId("");
            setScopeId("");
            setValidUntil("");
            router.refresh();
          });
        }}
      >
        <select aria-label="Role" value={roleId} onChange={(e) => setRoleId(e.target.value)} className="h-8 rounded-lg border bg-card px-2 text-[13px]" required>
          <option value="">Grant role…</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}{r.isGlobal ? " (institution-wide)" : ""}</option>)}
        </select>
        {role && !role.isGlobal && (
          <>
            <select aria-label="Scope type" value={scopeType} onChange={(e) => { setScopeType(e.target.value as ScopeType); setScopeId(""); }} className="h-8 rounded-lg border bg-card px-2 text-[13px]">
              <option value="own">User&apos;s own department</option>
              <option value="department">A department</option>
              <option value="unit">A faculty / school</option>
              <option value="campus">A campus</option>
            </select>
            {scopeType !== "own" && (
              <select aria-label="Scope" value={scopeId} onChange={(e) => setScopeId(e.target.value)} className="h-8 rounded-lg border bg-card px-2 text-[13px]" required>
                <option value="">Choose…</option>
                {scopeOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            )}
          </>
        )}
        {role && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Expires
            <input type="date" aria-label="Expiry date (optional)" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="h-8 rounded-lg border bg-card px-2 text-[13px] text-foreground" />
          </label>
        )}
        <Button type="submit" size="sm" disabled={!roleId || pending}>{pending ? <Loader2 className="animate-spin" /> : <Plus />} Grant</Button>
      </form>
    </div>
  );
}
