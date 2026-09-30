import Link from "next/link";
import { headers } from "next/headers";
import { CircleAlert, CircleCheck, CircleX } from "lucide-react";
import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";
import { fmtDate } from "@/lib/format";
import { isAppError } from "@/server/errors";
import { verifyCredential } from "@/server/services/credentials";

export const metadata: Metadata = { title: "Document verification", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Public verification result. Shows only what a verifier needs to match against the paper document.
 * The seal is recomputed on every request, so a record altered in the database shows as invalid.
 */
export default async function VerifyResultPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const h = await headers();
  const client = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "anon";
  let result: Awaited<ReturnType<typeof verifyCredential>> = null;
  let limited = false;
  try {
    result = await verifyCredential(code, client);
  } catch (e) {
    if (isAppError(e) && e.code === "RATE_LIMITED") limited = true;
    else throw e;
  }
  const valid = result && result.intact && result.status === "ISSUED";
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-12">
      <div className="text-xs font-semibold tracking-[0.15em] text-muted-foreground">{BRAND.name} · document verification</div>
      {limited ? (
        <p className="mt-6 text-sm">Too many checks from your network. Please wait a minute and try again.</p>
      ) : !result ? (
        <div className="mt-6 rounded-xl border p-6">
          <div className="flex items-center gap-2 text-lg font-semibold"><CircleX className="size-6 text-tone-danger" /> No document found</div>
          <p className="mt-2 text-sm text-muted-foreground">The code <span className="font-mono">{code}</span> does not match any document issued through this system. Check the code, or treat the document as unverified.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-4 rounded-xl border p-6">
          <div className="flex items-center gap-2 text-lg font-semibold">
            {valid ? <CircleCheck className="size-6 text-tone-success" /> : result.status === "SUPERSEDED" && result.intact ? <CircleAlert className="size-6 text-tone-warning" /> : <CircleX className="size-6 text-tone-danger" />}
            {!result.intact ? "Integrity check failed" : result.status === "REVOKED" ? "Revoked" : result.status === "SUPERSEDED" ? "Superseded by a newer version" : "Valid document"}
          </div>
          {!result.intact && <p className="text-sm text-tone-danger">The stored record does not match its seal. Do not rely on this document; contact the institution.</p>}
          {result.status === "REVOKED" && <p className="text-sm">Revoked on {fmtDate(result.revokedAt)}{result.revokeReason ? `: ${result.revokeReason}` : "."}</p>}
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Document</dt><dd className="font-medium">{result.title}</dd>
            <dt className="text-muted-foreground">Serial number</dt><dd className="font-mono">{result.serialNo}</dd>
            <dt className="text-muted-foreground">Issued by</dt><dd>{result.institution}</dd>
            <dt className="text-muted-foreground">Issued on</dt><dd>{fmtDate(result.issuedAt)}</dd>
            <dt className="text-muted-foreground">Name</dt><dd>{result.studentName}</dd>
            <dt className="text-muted-foreground">Student no.</dt><dd className="font-mono">{result.studentNo}</dd>
            <dt className="text-muted-foreground">Programme</dt><dd>{result.programme}</dd>
            {result.cgpa !== null && <><dt className="text-muted-foreground">CGPA</dt><dd>{result.cgpa}</dd></>}
          </dl>
          <p className="break-all font-mono text-[10px] text-muted-foreground">SHA-256 {result.contentHash}</p>
        </div>
      )}
      <Link href="/verify" className="mt-6 text-sm text-primary hover:underline">Verify another document</Link>
    </main>
  );
}
