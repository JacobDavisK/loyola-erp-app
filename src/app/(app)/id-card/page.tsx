import { IdCard as IdIcon } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/app/page";
import { requirePageAuth } from "@/server/auth/current";
import { myIdCard } from "@/server/services/idcard";
import { signedAssetUrl } from "@/server/storage";

export const metadata: Metadata = { title: "ID card" };

export default async function IdCardPage() {
  const ctx = await requirePageAuth();
  const card = await myIdCard(ctx).catch(() => null);
  if (!card) return <EmptyState icon={IdIcon} title="No ID card" description="ID cards are for students and employees." />;
  return (
    <div className="space-y-6">
      <PageHeader title="Digital ID card" description="Show this at the gate, library or examination hall. The QR code is refreshed every day and can be checked by scanning it with any phone." />
      <article aria-label="ID card" className="mx-auto max-w-sm overflow-hidden rounded-2xl border bg-card shadow-sm">
        <header className="bg-primary px-5 py-3 text-primary-foreground">
          <div className="text-xs font-semibold tracking-wider uppercase">{card.institution}</div>
          <div className="text-[11px] opacity-80">{card.kind} identity card</div>
        </header>
        <div className="flex gap-4 p-5">
          {card.photoAssetId ? (
            // eslint-disable-next-line @next/next/no-img-element -- private photo through a short-lived signed URL
            <img src={signedAssetUrl(card.photoAssetId, 600)} alt="" className="h-24 w-20 rounded-lg object-cover" />
          ) : (
            <div className="flex h-24 w-20 items-center justify-center rounded-lg bg-muted text-2xl font-semibold text-muted-foreground" aria-hidden>{card.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}</div>
          )}
          <div className="min-w-0 space-y-0.5">
            <div className="text-lg leading-tight font-semibold">{card.name}</div>
            <div className="font-mono text-sm">{card.number}</div>
            <div className="text-xs text-muted-foreground">{card.line}</div>
            {card.validTill && <div className="text-xs">Valid till {card.validTill}</div>}
            {card.bloodGroup && <div className="text-xs">Blood group {card.bloodGroup}</div>}
            {!card.active && <div className="text-xs font-semibold text-tone-danger">Not currently active</div>}
          </div>
        </div>
        <div className="flex justify-center border-t bg-white p-4"><div className="w-44" dangerouslySetInnerHTML={{ __html: card.qr }} /></div>
      </article>
    </div>
  );
}
