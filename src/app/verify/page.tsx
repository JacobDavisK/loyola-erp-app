import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Verify a document" };

async function go(form: FormData) {
  "use server";
  const code = String(form.get("code") ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 20);
  redirect(code ? `/verify/${code}` : "/verify");
}

/** Public: anyone (employer, embassy, another university) can check a transcript or certificate. */
export default function VerifyPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-12">
      <div className="text-xs font-semibold tracking-[0.15em] text-muted-foreground">{BRAND.name}</div>
      <h1 className="mt-2 text-2xl font-semibold">Verify a certificate or transcript</h1>
      <p className="mt-1 text-sm text-muted-foreground">Enter the verification code printed at the bottom of the document, or scan its QR code.</p>
      <form action={go} className="mt-6 flex gap-2">
        <label htmlFor="code" className="sr-only">Verification code</label>
        <input id="code" name="code" required placeholder="XXXX-XXXX-XXXX" autoComplete="off" className="h-10 flex-1 rounded-lg border bg-card px-3 font-mono text-sm uppercase outline-none focus-visible:ring-3 focus-visible:ring-ring/30" />
        <button className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">Verify</button>
      </form>
    </main>
  );
}
