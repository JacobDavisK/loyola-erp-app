import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MeetingRoom } from "@/features/video/room/meeting-room";
import { MEETING_TYPES, type MeetingType } from "@/lib/domain/video";
import { requirePageAuth } from "@/server/auth/current";
import { getBranding } from "@/server/branding";
import { canSee, loadMeeting } from "@/server/services/video/access";

export const metadata: Metadata = { title: "Meeting" };

export default async function MeetingRoomPage({ params }: { params: Promise<{ publicId: string }> }) {
  const ctx = await requirePageAuth();
  const { publicId } = await params;
  const m = await loadMeeting(publicId).catch(() => null);
  if (!m || !(await canSee(ctx, m))) notFound();
  const branding = await getBranding();
  return (
    <MeetingRoom
      meeting={{ id: m.id, publicId: m.publicId, title: m.title, typeLabel: MEETING_TYPES[m.meetingType as MeetingType].label, scheduledEnd: m.scheduledEnd.toISOString(), logo: branding.shortName.slice(0, 3) }}
      joinPath={`/api/video/meetings/${m.id}/join`}
      exitHref={`/video/${m.publicId}`}
    />
  );
}
