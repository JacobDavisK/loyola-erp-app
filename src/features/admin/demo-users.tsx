"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Copy, KeyRound, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { grantDemoAccessAction, resetDemoPasswordAction } from "@/features/admin/demo-actions";

type Issued = { email: string; password: string };

/** The generated credentials, shown once, with a message ready to paste into an e-mail or chat. */
function IssuedCredentials({ issued, account, signInUrl }: { issued: Issued; account: string; signInUrl: string }) {
  const [copied, setCopied] = useState<"pw" | "msg" | null>(null);
  const message = `You have access to the University of the World ERP demo as ${account}.\n\nSign in at: ${signInUrl}\nE-mail: ${issued.email}\nPassword: ${issued.password}\n\nPlease do not share these details.`;
  const copy = (text: string, what: "pw" | "msg") => void navigator.clipboard.writeText(text).then(() => setCopied(what));
  return (
    <div role="status" className="space-y-3 rounded-lg border border-tone-warning/40 bg-tone-warning/5 p-3">
      <p className="text-xs font-medium text-tone-warning">Copy these now — the password is not shown again (you can generate a new one).</p>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <span className="text-muted-foreground">E-mail</span><code className="font-mono">{issued.email}</code>
        <span className="text-muted-foreground">Password</span><code className="font-mono text-base tracking-wide">{issued.password}</code>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => copy(issued.password, "pw")}>{copied === "pw" ? <Check /> : <Copy />} Copy password</Button>
        <Button size="sm" variant="outline" onClick={() => copy(message, "msg")}>{copied === "msg" ? <Check /> : <Copy />} Copy message to send</Button>
      </div>
    </div>
  );
}

export function GrantDemoAccess({ demoUserId, account, signInUrl }: { demoUserId: string; account: string; signInUrl: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [days, setDays] = useState("30");
  const [issued, setIssued] = useState<Issued | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setEmail(""); setName(""); setDays("30"); setIssued(null); } }}>
      <DialogTrigger asChild><Button size="xs" variant="outline"><UserPlus /> Give access</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Give access to {account}</DialogTitle>
          <DialogDescription>The person signs in with their own e-mail and the password generated here, and works as this demo account.</DialogDescription>
        </DialogHeader>
        {issued ? <IssuedCredentials issued={issued} account={account} signInUrl={signInUrl} /> : (
          <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await grantDemoAccessAction(demoUserId, { email, name: name || null, expiresInDays: days ? Number(days) : null });
              if (!r.ok) { toast.error(r.error); return; }
              setIssued(r.data as Issued);
              router.refresh();
            });
          }}>
            <div className="space-y-1"><Label htmlFor={`dg-email-${demoUserId}`}>Their e-mail</Label><Input id={`dg-email-${demoUserId}`} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" /></div>
            <div className="space-y-1"><Label htmlFor={`dg-name-${demoUserId}`}>Their name (optional)</Label><Input id={`dg-name-${demoUserId}`} value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor={`dg-days-${demoUserId}`}>Access ends</Label>
              <select id={`dg-days-${demoUserId}`} className="h-9 w-full rounded-lg border bg-card px-2 text-sm" value={days} onChange={(e) => setDays(e.target.value)}>
                <option value="7">after 7 days</option><option value="30">after 30 days</option><option value="90">after 90 days</option><option value="">never (until revoked)</option>
              </select>
            </div>
            <Button type="submit" disabled={pending || !email.trim()}>{pending ? <Loader2 className="animate-spin" /> : <KeyRound />} Generate password</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ResetDemoPassword({ grantId, account, signInUrl }: { grantId: string; account: string; signInUrl: string }) {
  const router = useRouter();
  const [issued, setIssued] = useState<Issued | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={!!issued} onOpenChange={(o) => { if (!o) setIssued(null); }}>
      <Button size="xs" variant="ghost" disabled={pending} onClick={() => {
        if (!confirm("Generate a new password? The old one stops working and their open sessions end.")) return;
        start(async () => {
          const r = await resetDemoPasswordAction(grantId);
          if (!r.ok) { toast.error(r.error); return; }
          setIssued(r.data as Issued);
          router.refresh();
        });
      }}>{pending ? <Loader2 className="animate-spin" /> : <KeyRound />} New password</Button>
      <DialogContent>
        <DialogHeader><DialogTitle>New password</DialogTitle><DialogDescription>For {account}.</DialogDescription></DialogHeader>
        {issued && <IssuedCredentials issued={issued} account={account} signInUrl={signInUrl} />}
      </DialogContent>
    </Dialog>
  );
}
