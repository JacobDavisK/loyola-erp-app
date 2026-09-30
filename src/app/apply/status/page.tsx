import type { Metadata } from "next";
import { OfferResponse } from "@/features/campus/controls";
import { fmtDate } from "@/lib/format";
import { applicationByToken } from "@/server/services/admissions";

export const metadata: Metadata = { title: "Application status", robots: { index: false } };
export const dynamic = "force-dynamic";

const TEXT: Record<string, string> = {
  SUBMITTED: "Received. The admissions office will verify your details and documents.",
  VERIFIED: "Verified. You are on the merit list; offers are made in merit order as seats are available.",
  REJECTED: "Your application could not be taken forward.",
  OFFERED: "You have an offer of admission. Accept it before it lapses.",
  ACCEPTED: "You accepted the offer. The admissions office will complete your enrolment.",
  DECLINED: "The offer was declined or lapsed.",
  ENROLLED: "You are enrolled. Welcome! Your student number and sign-in details will follow by e-mail.",
  WITHDRAWN: "The application was withdrawn.",
};

/** Private status page: requires the application number and the secret token from the confirmation e-mail. */
export default async function StatusPage({ searchParams }: { searchParams: Promise<{ n?: string; t?: string; new?: string }> }) {
  const sp = await searchParams;
  const a = sp.n && sp.t ? await applicationByToken(sp.n, sp.t).catch(() => null) : null;
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-2xl font-semibold">Application status</h1>
      {!a ? (
        <p className="mt-4 text-sm text-muted-foreground">This link is incomplete or not valid. Use the link from your confirmation e-mail.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {sp.new && <p className="rounded-lg border border-tone-success/40 bg-tone-success/5 px-4 py-3 text-sm">Your application has been submitted. <b>Bookmark this page</b> — it is your private link.</p>}
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Application</dt><dd className="font-mono">{a.number}</dd>
            <dt className="text-muted-foreground">Name</dt><dd>{a.firstName} {a.lastName}</dd>
            <dt className="text-muted-foreground">Programme</dt><dd>{a.program.name}</dd>
            <dt className="text-muted-foreground">Admission</dt><dd>{a.cycle.name}</dd>
          </dl>
          <p className="text-sm"><b>{TEXT[a.status]}</b>{a.status === "REJECTED" && a.remarks ? ` ${a.remarks}` : ""}</p>
          {a.status === "OFFERED" && (
            <>
              {a.offerExpiresAt && <p className="text-sm text-muted-foreground">The offer is valid until {fmtDate(a.offerExpiresAt)}.</p>}
              <OfferResponse number={a.number} token={sp.t!} />
            </>
          )}
        </div>
      )}
    </main>
  );
}
