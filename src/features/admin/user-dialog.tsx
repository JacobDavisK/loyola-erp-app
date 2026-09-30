"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Pencil, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createUserAction, updateUserAction } from "@/features/admin/actions";

type Opt = { id: string; label: string };
const field = "h-9 w-full rounded-lg border bg-card px-2.5 text-sm";

export function UserDialog({ departments, roles, userId, initial }: { departments: Opt[]; roles: (Opt & { isGlobal: boolean })[]; userId?: string; initial?: { name: string; email: string; employeeId: string; designation: string; phone: string; departmentId: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(initial ?? { name: "", email: "", employeeId: "", designation: "", phone: "", departmentId: "" });
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{userId ? <Button size="sm" variant="outline"><Pencil /> Edit profile</Button> : <Button size="sm"><UserPlus /> New user</Button>}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const payload = { ...v, designation: v.designation || null, phone: v.phone || null, departmentId: v.departmentId || null };
              const res = userId ? await updateUserAction(userId, payload) : await createUserAction({ ...payload, roles: roleIds.map((roleId) => ({ roleId, departmentId: roles.find((r) => r.id === roleId)?.isGlobal ? null : v.departmentId || null })) });
              if (!res.ok) {
                toast.error(res.error, { description: res.fieldErrors ? Object.values(res.fieldErrors).flat().join(" · ") : undefined });
                return;
              }
              toast.success(res.message ?? "Saved");
              setOpen(false);
              if (!userId && res.data && typeof res.data === "object" && "id" in res.data) router.push(`/admin/users/${(res.data as { id: string }).id}`);
              else router.refresh();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{userId ? "Edit user" : "New user"}</DialogTitle>
            <DialogDescription>{userId ? "Update profile details." : "The user receives an e-mail invitation to set their own password. Administrators never see passwords."}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="u-name">Full name</Label><Input id="u-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required /></div>
            <div className="space-y-1.5"><Label htmlFor="u-email">E-mail</Label><Input id="u-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} required /></div>
            <div className="space-y-1.5"><Label htmlFor="u-emp">Employee ID</Label><Input id="u-emp" value={v.employeeId} onChange={(e) => setV({ ...v, employeeId: e.target.value.toUpperCase() })} required /></div>
            <div className="space-y-1.5"><Label htmlFor="u-des">Designation</Label><Input id="u-des" value={v.designation} onChange={(e) => setV({ ...v, designation: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="u-phone">Phone</Label><Input id="u-phone" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="u-dept">Department</Label>
              <select id="u-dept" className={field} value={v.departmentId} onChange={(e) => setV({ ...v, departmentId: e.target.value })}>
                <option value="">None (institution-wide)</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </div>
          </div>
          {!userId && (
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Roles</legend>
              <div className="grid grid-cols-2 gap-1.5">
                {roles.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm">
                    <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={roleIds.includes(r.id)} onChange={(e) => setRoleIds((x) => (e.target.checked ? [...x, r.id] : x.filter((y) => y !== r.id)))} />
                    {r.label}
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">Departmental roles are scoped to the selected department.</p>
            </fieldset>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending || (!userId && roleIds.length === 0)}>{pending && <Loader2 className="animate-spin" />} {userId ? "Save" : "Create & invite"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
