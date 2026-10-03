import type { Metadata } from "next";
import { MeetingRoom } from "@/features/video/room/meeting-room";
import { getBranding } from "@/server/branding";
import { guestMeetingInfo } from "@/server/services/video/meetings";

export const metadata: Metadata = { title: "Meeting", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** A guest's personal link: no ERP account, only this meeting, only until the link expires. */
export default async function GuestMeetingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [info, branding] = await Promise.all([guestMeetingInfo(token), getBranding()]);
  if (!info) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-[#0b0c10] px-6 text-center text-white">
        <h1 className="text-xl font-semibold">This invitation link is not valid</h1>
        <p className="mt-2 max-w-md text-white/60">It may have expired or been withdrawn. Please contact the person who invited you.</p>
      </main>
    );
  }
  return (
    <MeetingRoom
      guest
      meeting={{ id: "guest", publicId: info.type, title: info.title, typeLabel: `${info.type} · ${branding.universityName}`, scheduledEnd: info.scheduledEnd.toISOString(), logo: branding.shortName.slice(0, 3) }}
      joinPath="/api/video/guest/join"
      joinBody={{ token }}
      exitHref="/meet/guest/left"
    />
  );
}
