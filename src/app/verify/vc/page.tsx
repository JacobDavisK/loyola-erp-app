import type { Metadata } from "next";
import { VerifyVcForm } from "@/features/wallet/controls";
import { BRAND } from "@/lib/brand";
import { institutionDid } from "@/server/services/vc";

export const metadata: Metadata = { title: "Verify a digital credential" };
export const dynamic = "force-dynamic";

/** Public: check a verifiable credential (badge, certificate, learner record) issued by the institution. */
export default function VerifyVcPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-4 py-12">
      <div className="text-xs font-semibold tracking-[0.15em] text-muted-foreground">{BRAND.name}</div>
      <h1 className="mt-2 text-2xl font-semibold">Verify a digital credential</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">Paste the contents of the credential file. Credentials are signed by {institutionDid()}; any W3C Verifiable Credentials verifier can also check them using the public key in the institution&apos;s DID document.</p>
      <VerifyVcForm />
    </main>
  );
}
