"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CreditCard, Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  cancelInvoiceAction, disburseScholarshipAction, markRefundPaidAction, recordPaymentAction, requestConcessionAction, requestRefundAction, reversePaymentAction, startOnlinePaymentAction,
} from "@/features/finance/actions";

const field = "h-9 w-full rounded-lg border bg-card px-2.5 text-sm";
type R = { ok: true; data?: unknown; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return {
    pending,
    run: (fn: () => Promise<R>, after?: (r: R & { ok: true }) => void) =>
      start(async () => {
        const r = await fn();
        if (!r.ok) {
          toast.error(r.error, { description: r.fieldErrors ? Object.values(r.fieldErrors).flat().join(" · ") : undefined });
          return;
        }
        toast.success(r.message ?? "Done");
        after?.(r);
        router.refresh();
      }),
  };
}

/**
 * Counter payment. A fresh idempotency key is created each time the dialog opens, so a double click or a
 * network retry can never record the same payment twice.
 */
export function RecordPaymentDialog({ studentId, invoiceId, balance, currency }: { studentId: string; invoiceId?: string; balance: number; currency: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [amount, setAmount] = useState((balance / 100).toFixed(2));
  const [method, setMethod] = useState("CASH");
  const [reference, setReference] = useState("");
  const { pending, run } = useRun();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setKey(crypto.randomUUID()); setAmount((balance / 100).toFixed(2)); setReference(""); } }}>
      <DialogTrigger asChild><Button size="sm"><Wallet /> Record payment</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a counter payment</DialogTitle>
          <DialogDescription>Applied to this invoice first, then to the oldest open invoices. Any excess is held as credit.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="p-amt">Amount ({currency})</Label><Input id="p-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} /></div>
          <div className="space-y-1.5">
            <Label htmlFor="p-method">Method</Label>
            <select id="p-method" className={field} value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="CASH">Cash</option><option value="CHEQUE">Cheque</option><option value="DEMAND_DRAFT">Demand draft</option><option value="BANK_TRANSFER">Bank transfer</option><option value="CARD_POS">Card (POS)</option>
            </select>
          </div>
          {method !== "CASH" && <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="p-ref">Reference (cheque / DD / UTR / slip no.)</Label><Input id="p-ref" value={reference} onChange={(e) => setReference(e.target.value)} /></div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={pending || !(Number(amount) > 0)} onClick={() => run(() => recordPaymentAction(null, { studentId, invoiceId, amount: Number(amount), method, reference: reference || null, idempotencyKey: key }), (r) => {
            setOpen(false);
            const d = r.data as { id: string; receiptNo: string };
            toast.success(`Receipt ${d.receiptNo}`, { action: { label: "Print", onClick: () => router.push(`/finance/payments/${d.id}`) } });
          })}>{pending && <Loader2 className="animate-spin" />} Record & issue receipt</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConcessionDialog({ invoiceId, balance, heads }: { invoiceId: string; balance: number; heads: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState("CONCESSION");
  const [head, setHead] = useState("");
  const [reason, setReason] = useState("");
  const { pending, run } = useRun();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline">Request concession</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Concession or waiver</DialogTitle><DialogDescription>Goes to the Finance Officer (and the Registrar for large amounts). Applied to the invoice when approved.</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="c-amt">Amount (max {(balance / 100).toFixed(2)})</Label><Input id="c-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} /></div>
          <div className="space-y-1.5"><Label htmlFor="c-kind">Type</Label><select id="c-kind" className={field} value={kind} onChange={(e) => setKind(e.target.value)}><option value="CONCESSION">Concession</option><option value="WAIVER">Waiver</option></select></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="c-head">Against fee head (optional)</Label><select id="c-head" className={field} value={head} onChange={(e) => setHead(e.target.value)}><option value="">Spread over the invoice</option>{heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="c-reason">Reason</Label><Input id="c-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={pending || !(Number(amount) > 0) || reason.trim().length < 10} onClick={() => run(() => requestConcessionAction(invoiceId, { amount: Number(amount), kind, feeHeadId: head || null, reason }), () => setOpen(false))}>{pending && <Loader2 className="animate-spin" />} Submit for approval</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PromptButton({ label, question, action, variant = "outline", destructive }: { label: string; question: string; action: (answer: string) => Promise<R>; variant?: "outline" | "ghost"; destructive?: boolean }) {
  const { pending, run } = useRun();
  return (
    <Button size="sm" variant={variant} className={destructive ? "text-destructive" : undefined} disabled={pending} onClick={() => {
      const a = prompt(question);
      if (a) run(() => action(a));
    }}>{pending && <Loader2 className="animate-spin" />} {label}</Button>
  );
}

export const CancelInvoiceButton = ({ id }: { id: string }) => <PromptButton label="Cancel invoice" destructive question="Reason for cancelling this invoice?" action={(r) => cancelInvoiceAction(id, r)} />;
export const ReversePaymentButton = ({ id }: { id: string }) => <PromptButton label="Reverse payment" destructive question="Reason for reversing (e.g. cheque bounced)?" action={(r) => reversePaymentAction(id, r)} />;
export const MarkRefundPaidButton = ({ id }: { id: string }) => <PromptButton label="Mark paid" variant="ghost" question="Payout reference (NEFT/cheque no.)?" action={(r) => markRefundPaidAction(id, r)} />;

export function RefundButton({ paymentId, max }: { paymentId: string; max: number }) {
  const { pending, run } = useRun();
  return (
    <Button size="sm" variant="outline" disabled={pending || max <= 0} title={max <= 0 ? "No unapplied credit on this payment" : undefined} onClick={() => {
      const amount = prompt(`Refund amount (up to ${(max / 100).toFixed(2)})?`);
      if (!amount) return;
      const reason = prompt("Reason for the refund?");
      if (reason) run(() => requestRefundAction(paymentId, { amount: Number(amount), reason }));
    }}>Request refund</Button>
  );
}

export function DisburseButton({ id }: { id: string }) {
  const { pending, run } = useRun();
  return <Button size="xs" disabled={pending} onClick={() => run(() => disburseScholarshipAction(id))}>{pending && <Loader2 className="animate-spin" />} Credit award</Button>;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

/** Online payment via the configured provider. Loads the provider's checkout script only when used. */
export function PayOnlineButton({ invoiceId, enabled }: { invoiceId: string; enabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!enabled) return null;
  return (
    <Button size="sm" disabled={pending} onClick={() => start(async () => {
      const r = await startOnlinePaymentAction(invoiceId);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      if (r.data.provider !== "razorpay") {
        toast.error("Unsupported payment provider.");
        return;
      }
      if (!window.Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://checkout.razorpay.com/v1/checkout.js";
          s.onload = () => resolve();
          s.onerror = () => reject(new Error("Could not load the payment page."));
          document.head.appendChild(s);
        }).catch((e) => toast.error(e.message));
      }
      if (!window.Razorpay) return;
      new window.Razorpay({
        ...r.data.checkout,
        handler: async (resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          const res = await fetch("/api/payments/callback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature }) });
          const body = await res.json();
          if (!res.ok) toast.error(body.error ?? "The payment could not be confirmed yet. It will update automatically once the bank confirms it.");
          else toast.success(`Payment received. Receipt ${body.data.receiptNo}`);
          router.refresh();
        },
      }).open();
    })}>{pending ? <Loader2 className="animate-spin" /> : <CreditCard />} Pay online</Button>
  );
}
