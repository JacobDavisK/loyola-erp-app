import { notFound } from "next/navigation";
import QRCode from "qrcode";
import type { Metadata } from "next";
import { PrintButton } from "@/components/app/print-button";
import { StatusBadge } from "@/components/app/status-badge";
import { RevokeCredentialButton } from "@/features/results/credential-controls";
import { CREDENTIAL_STATUS } from "@/lib/domain/labels";
import { fmtDate } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { env } from "@/server/env";
import { loadCredentialFor } from "@/server/services/credentials";

export const metadata: Metadata = { title: "Credential" };

type Payload = {
  institution: { name: string; address: string | null };
  student: { name: string; studentNo: string; registrationNo: string | null; dateOfBirth: string | null };
  programme: { code: string; name: string; batch: string; department: string };
  issuedOn: string;
  statement?: string;
  purpose?: string | null;
  terms?: { term: string; sgpa: number | null; courses: { code: string; title: string; credits: number; grade: string; gradePoint: number; status: string; attempt: number; marks: number | null; maxMarks: number }[] }[];
  cgpa?: number | null;
  creditsEarned?: number | null;
};

export default async function CredentialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth();
  const c = await loadCredentialFor(ctx, id).catch(() => null);
  if (!c) notFound();
  const p = c.payload as unknown as Payload;
  const url = `${env.APP_URL}/verify/${c.verificationCode}`;
  // The QR code is generated server-side from our own verification URL.
  const qr = await QRCode.toString(url, { type: "svg", margin: 0, width: 112, errorCorrectionLevel: "M" });
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-end gap-2 print:hidden">
        <StatusBadge meta={CREDENTIAL_STATUS[c.status]} size="md" />
        {can(ctx, "credential.revoke") && c.status === "ISSUED" && <RevokeCredentialButton id={c.id} />}
        <PrintButton />
      </div>
      <article className="surface-card relative space-y-6 p-10 print:border-black print:shadow-none">
        {c.status !== "ISSUED" && <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center text-7xl font-bold tracking-widest text-tone-danger/15 -rotate-12">{c.status}</div>}
        <header className="flex items-start justify-between gap-6 border-b pb-5">
          <div>
            <div className="text-xl font-semibold">{p.institution.name}</div>
            {p.institution.address && <div className="text-xs text-muted-foreground">{p.institution.address}</div>}
            <div className="mt-3 text-sm font-semibold tracking-[0.15em] uppercase">{c.title}</div>
          </div>
          <div className="text-right text-xs">
            <div className="font-mono">{c.serialNo}</div>
            <div className="text-muted-foreground">Issued {fmtDate(c.issuedAt)}</div>
          </div>
        </header>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Name</dt><dd className="font-medium">{p.student.name}</dd>
          <dt className="text-muted-foreground">Student no.</dt><dd className="font-mono">{p.student.studentNo}</dd>
          {p.student.registrationNo && <><dt className="text-muted-foreground">Registration no.</dt><dd className="font-mono">{p.student.registrationNo}</dd></>}
          <dt className="text-muted-foreground">Programme</dt><dd>{p.programme.name} ({p.programme.batch})</dd>
          <dt className="text-muted-foreground">Department</dt><dd>{p.programme.department}</dd>
        </dl>
        {p.statement && <p className="text-base leading-relaxed">{p.statement}</p>}
        {p.purpose && <p className="text-sm text-muted-foreground">Issued for: {p.purpose}</p>}
        {p.terms?.map((t) => (
          <section key={t.term}>
            <h3 className="mb-1 text-sm font-semibold">{t.term}{t.sgpa !== null ? ` · SGPA ${t.sgpa}` : ""}</h3>
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1">Code</th><th>Course</th><th className="text-right">Credits</th><th className="text-right">Marks</th><th className="text-center">Grade</th><th className="text-right">Points</th></tr></thead>
              <tbody className="divide-y">
                {t.courses.map((x) => (
                  <tr key={`${x.code}${x.attempt}`}><td className="py-1 font-mono text-xs">{x.code}</td><td>{x.title}{x.attempt > 1 ? ` (attempt ${x.attempt})` : ""}</td><td className="text-right tabular">{x.credits}</td><td className="text-right tabular">{x.marks ?? "—"}/{x.maxMarks}</td><td className="text-center font-semibold">{x.grade}</td><td className="text-right tabular">{x.gradePoint}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        {p.cgpa !== undefined && <p className="text-sm font-semibold">Cumulative GPA: {p.cgpa ?? "—"}{p.creditsEarned ? ` · credits earned ${p.creditsEarned}` : ""}</p>}
        <footer className="flex items-end justify-between gap-6 border-t pt-5">
          <div className="max-w-md text-xs text-muted-foreground">
            Verify this document at <span className="font-mono text-foreground">{env.APP_URL}/verify</span> with code <span className="font-mono font-semibold text-foreground">{c.verificationCode}</span>, or scan the QR code.
            <div className="mt-1 break-all font-mono text-[10px]">SHA-256 {c.contentHash}</div>
          </div>
          <div aria-label="Verification QR code" className="size-28 shrink-0 [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: qr }} />
        </footer>
      </article>
    </div>
  );
}
