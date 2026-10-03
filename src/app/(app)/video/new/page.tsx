import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/app/page";
import { schedulerOptions } from "@/features/video/data";
import { MeetingScheduler } from "@/features/video/scheduler";
import { isMeetingType } from "@/lib/domain/video";
import { requirePageAuth } from "@/server/auth/current";

export const metadata: Metadata = { title: "Schedule meeting" };

export default async function NewMeetingPage({ searchParams }: { searchParams: Promise<{ type?: string; offering?: string; mentee?: string }> }) {
  const ctx = await requirePageAuth(["video.schedule", "video.create"]);
  const sp = await searchParams;
  const o = await schedulerOptions(ctx);
  const tz = o.timezone;
  // Default: the next half hour, for the default duration, in the institution's time zone.
  const start = new Date(Math.ceil(new Date().getTime() / 1_800_000) * 1_800_000);
  const end = new Date(start.getTime() + o.defaults.defaultDurationMinutes * 60_000);
  const part = (d: Date, opt: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, ...opt }).format(d);
  const hm = (d: Date) => part(d, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const type = sp.type && isMeetingType(sp.type) && o.types.some((t) => t.id === sp.type) ? sp.type : sp.offering ? "ONLINE_CLASS" : sp.mentee ? "STUDENT_MENTORING" : o.types.find((t) => t.id === "GENERAL_MEETING")?.id ?? o.types[0]?.id ?? "GENERAL_MEETING";
  return (
    <div className="space-y-6">
      <PageHeader title="Schedule a meeting" breadcrumbs={[{ label: "Meetings", href: "/video" }, { label: "Schedule" }]} description="Participants are invited by notification and e-mail. Online classes invite the whole class automatically." />
      <Section title="Details">
        <MeetingScheduler
          types={o.types} offerings={o.offerings} mentees={o.mentees} departments={o.departments} recordingAvailable={o.recordingAvailable} timezone={tz}
          initial={{
            title: "", description: "", meetingType: type, offeringId: sp.offering ?? "", mentoringStudentId: sp.mentee ?? "", departmentId: "",
            date: part(start, { year: "numeric", month: "2-digit", day: "2-digit" }), start: hm(start), end: hm(end), visibility: type === "ONLINE_CLASS" ? "COURSE" : "INVITED",
            people: [], lobbyEnabled: o.defaults.lobbyDefault, recordingEnabled: false, autoRecord: false, chatEnabled: o.defaults.chatDefault, screenShareEnabled: o.defaults.screenShareDefault, participantsCanPublish: true,
            recordingAccess: type === "ONLINE_CLASS" ? "COURSE" : o.defaults.recordingAccessDefault,
          }}
        />
      </Section>
    </div>
  );
}
