import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/app/page";
import { EventCheckIn } from "@/features/campuslife/controls";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Mark attendance" };

/** Opened by scanning the event's QR code at the venue. */
export default async function AttendPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ k?: string }> }) {
  const { id } = await params;
  const { k } = await searchParams;
  await requirePageAuth();
  const e = await db.campusEvent.findUnique({ where: { id }, select: { title: true, venue: true } });
  return (
    <div className="mx-auto max-w-md space-y-6">
      <PageHeader title="Mark attendance" description={e ? `${e.title} · ${e.venue}` : undefined} />
      <Section>{e && k ? <EventCheckIn eventId={id} k={k} /> : <p className="text-sm text-muted-foreground">Scan the QR code shown at the venue again.</p>}</Section>
    </div>
  );
}
