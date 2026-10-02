import type { Metadata } from "next";
import { QrCode } from "lucide-react";
import { EmptyState, PageHeader, Section } from "@/components/app/page";
import { CheckInClient } from "@/features/teaching/controls";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Check in" };

/** Opened by scanning the classroom QR code. */
export default async function CheckInPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> }) {
  const { id } = await params;
  const { t } = await searchParams;
  const ctx = await requirePageAuth();
  const w = await db.checkInWindow.findUnique({ where: { id }, include: { meeting: { select: { offering: { select: { section: true, course: { select: { code: true, title: true } } } } } } } });
  if (!w || !t) return <EmptyState icon={QrCode} title="Check-in not found" description="Scan the QR code on the classroom screen again." />;
  if (!ctx.subject.studentId) return <EmptyState icon={QrCode} title="Students only" description="Sign in with your student account to check in." />;
  const open = w.closesAt > new Date();
  return (
    <div className="mx-auto max-w-md space-y-6">
      <PageHeader title="Check in" description={`${w.meeting.offering.course.code}-${w.meeting.offering.section} · ${w.meeting.offering.course.title}`} />
      <Section>{open ? <CheckInClient windowId={w.id} token={t} needsLocation={w.requireLocation} /> : <p className="text-sm text-muted-foreground">Check-in for this class has closed. Ask your teacher.</p>}</Section>
    </div>
  );
}
