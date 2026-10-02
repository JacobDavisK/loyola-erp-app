import type { Metadata } from "next";
import { BadgeCheck, CircleX } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { checkIdToken } from "@/server/services/idcard";

export const metadata: Metadata = { title: "ID check" };
export const dynamic = "force-dynamic";

/** Opened by scanning an ID card's QR code (no sign-in): confirms who the card belongs to. */
export default async function IdCheckPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await checkIdToken(decodeURIComponent(token));
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-12">
      <div className="text-xs font-semibold tracking-[0.15em] text-muted-foreground">{BRAND.tagline}</div>
      {r.ok ? (
        <div className={r.active ? "mt-3 rounded-xl border border-tone-success/40 bg-tone-success/5 p-5" : "mt-3 rounded-xl border border-tone-danger/40 bg-tone-danger/5 p-5"}>
          <p className="flex items-center gap-2 font-semibold">
            {r.active ? <><BadgeCheck className="size-5 text-tone-success" /> Valid {r.kind.toLowerCase()} ID</> : <><CircleX className="size-5 text-tone-danger" /> Not currently active ({r.status.toLowerCase().replace("_", " ")})</>}
          </p>
          <p className="mt-3 text-xl font-semibold">{r.name}</p>
          <p className="font-mono text-sm">{r.number}</p>
          <p className="text-sm text-muted-foreground">{r.line}</p>
          <p className="mt-3 text-xs text-muted-foreground">Compare the name with the person and the photo on their card.</p>
        </div>
      ) : (
        <p className="mt-3 rounded-xl border border-tone-danger/40 bg-tone-danger/5 p-5 text-sm">{r.reason}</p>
      )}
    </main>
  );
}
