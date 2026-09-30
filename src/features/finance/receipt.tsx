import { formatMoney, toMinor } from "@/lib/domain/money";
import { PAYMENT_METHOD_LABEL } from "@/lib/domain/labels";
import { fmtDateTime } from "@/lib/format";
import { db } from "@/server/db";

/** Printable receipt. The caller has already checked access to the payment. */
export async function Receipt({ paymentId }: { paymentId: string }) {
  const [p, inst] = await Promise.all([
    db.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { student: { select: { studentNo: true, firstName: true, lastName: true, program: { select: { name: true } } } }, allocations: { include: { invoice: { select: { number: true } } } } },
    }),
    db.institution.findFirstOrThrow(),
  ]);
  const fmt = (m: number) => formatMoney(m, p.currency, inst.locale);
  const applied = p.allocations.reduce((a, x) => a + toMinor(x.amount), 0);
  return (
    <article className="surface-card relative space-y-5 p-8 print:border-black print:shadow-none">
      {p.status !== "SUCCEEDED" && <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center text-6xl font-bold tracking-widest text-tone-danger/15 -rotate-12">{p.status}</div>}
      <header className="flex justify-between gap-4 border-b pb-4">
        <div><div className="text-lg font-semibold">{inst.name}</div><div className="text-xs text-muted-foreground">{inst.address}</div></div>
        <div className="text-right"><div className="text-xs font-semibold tracking-[0.15em]">RECEIPT</div><div className="font-mono">{p.receiptNo ?? "—"}</div><div className="text-xs text-muted-foreground">{fmtDateTime(p.confirmedAt ?? p.receivedAt)}</div></div>
      </header>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Received from</dt><dd className="font-medium">{p.student.firstName} {p.student.lastName} ({p.student.studentNo})</dd>
        <dt className="text-muted-foreground">Programme</dt><dd>{p.student.program.name}</dd>
        <dt className="text-muted-foreground">Amount</dt><dd className="text-lg font-semibold tabular">{fmt(toMinor(p.amount))}</dd>
        <dt className="text-muted-foreground">Method</dt><dd>{PAYMENT_METHOD_LABEL[p.method]}{p.reference ? ` · ${p.reference}` : ""}{p.gatewayPaymentId ? ` · ${p.gatewayPaymentId}` : ""}</dd>
      </dl>
      <table className="w-full text-sm">
        <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5">Applied to invoice</th><th className="text-right">Amount</th></tr></thead>
        <tbody className="divide-y">
          {p.allocations.map((a) => <tr key={a.id}><td className="py-1.5 font-mono text-xs">{a.invoice.number}</td><td className="text-right tabular">{fmt(toMinor(a.amount))}</td></tr>)}
          {toMinor(p.amount) - applied > 0 && <tr><td className="py-1.5">Held as credit on account</td><td className="text-right tabular">{fmt(toMinor(p.amount) - applied)}</td></tr>}
        </tbody>
      </table>
      {p.status === "REVERSED" && <p className="text-sm text-destructive">Reversed on {fmtDateTime(p.reversedAt)} — {p.reversalReason}</p>}
      <p className="text-xs text-muted-foreground">Computer-generated receipt. Every receipt is recorded in the institution&apos;s ledger and audit log.</p>
    </article>
  );
}
