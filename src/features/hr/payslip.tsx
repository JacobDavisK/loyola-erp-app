import { formatMoney } from "@/lib/domain/money";
import { toMinor } from "@/lib/domain/money";
import { db } from "@/server/db";
import { maskedPayDetails } from "@/server/services/hr";

type Line = { code: string; name: string; kind: string; amount: number };

/** Printable payslip. The caller has already checked access (loadPayslipFor). */
export async function Payslip({ id }: { id: string }) {
  const [p, inst] = await Promise.all([
    db.payslip.findUniqueOrThrow({ where: { id }, include: { run: true, employee: { include: { department: { select: { name: true } } } } } }),
    db.institution.findFirstOrThrow(),
  ]);
  const fmt = (m: number) => formatMoney(m, inst.currency, inst.locale);
  const lines = p.lines as unknown as Line[];
  const earnings = lines.filter((l) => l.kind === "BASIC" || l.kind === "EARNING");
  const deductions = lines.filter((l) => l.kind === "DEDUCTION");
  const employer = lines.filter((l) => l.kind === "EMPLOYER_CONTRIBUTION");
  const pay = maskedPayDetails(p.employee);
  const [y, m] = p.run.period.split("-").map(Number);
  const month = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const draft = !["APPROVED", "PAID"].includes(p.run.status);
  const row = (l: Line) => <tr key={l.code}><td className="py-1">{l.name}</td><td className="text-right tabular">{fmt(Math.round(l.amount * 100))}</td></tr>;
  return (
    <article className="surface-card relative space-y-5 p-8 print:border-black print:shadow-none">
      {draft && <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center text-6xl font-bold tracking-widest text-tone-warning/20 -rotate-12">DRAFT</div>}
      <header className="flex justify-between gap-4 border-b pb-4">
        <div><div className="text-lg font-semibold">{inst.name}</div><div className="text-xs text-muted-foreground">{inst.address}</div></div>
        <div className="text-right"><div className="text-xs font-semibold tracking-[0.15em]">PAYSLIP</div><div className="font-medium">{month}</div></div>
      </header>
      <dl className="grid grid-cols-[max-content_1fr_max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Employee</dt><dd className="font-medium">{p.employee.firstName} {p.employee.lastName}</dd>
        <dt className="text-muted-foreground">Employee no.</dt><dd className="font-mono">{p.employee.employeeNo}</dd>
        <dt className="text-muted-foreground">Designation</dt><dd>{p.employee.designation}</dd>
        <dt className="text-muted-foreground">Department</dt><dd>{p.employee.department?.name ?? "—"}</dd>
        <dt className="text-muted-foreground">Bank account</dt><dd className="font-mono">{pay.bankAccount}</dd>
        <dt className="text-muted-foreground">Tax id</dt><dd className="font-mono">{pay.taxId}</dd>
        <dt className="text-muted-foreground">Payable days</dt><dd className="tabular">{p.workingDays - p.lopDays} of {p.workingDays}</dd>
        <dt className="text-muted-foreground">Loss of pay</dt><dd className="tabular">{p.lopDays} day(s)</dd>
      </dl>
      <div className="grid gap-6 sm:grid-cols-2">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5">Earnings</th><th className="text-right">Amount</th></tr></thead>
          <tbody className="divide-y">{earnings.map(row)}</tbody>
          <tfoot><tr className="border-t font-medium"><td className="py-1.5">Gross</td><td className="text-right tabular">{fmt(toMinor(p.gross))}</td></tr></tfoot>
        </table>
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5">Deductions</th><th className="text-right">Amount</th></tr></thead>
          <tbody className="divide-y">{deductions.map(row)}</tbody>
          <tfoot><tr className="border-t font-medium"><td className="py-1.5">Total deductions</td><td className="text-right tabular">{fmt(toMinor(p.deductions))}</td></tr></tfoot>
        </table>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3"><span className="text-sm font-medium">Net pay</span><span className="text-xl font-semibold tabular">{fmt(toMinor(p.net))}</span></div>
      {employer.length > 0 && <p className="text-xs text-muted-foreground">Employer contributions (not deducted from pay): {employer.map((l) => `${l.name} ${fmt(Math.round(l.amount * 100))}`).join(" · ")}</p>}
      <p className="text-xs text-muted-foreground">Computer-generated payslip. Tax withheld is an estimate based on the institution&apos;s configured slabs; your final liability depends on your declarations.</p>
    </article>
  );
}
