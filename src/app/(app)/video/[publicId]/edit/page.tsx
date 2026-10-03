import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/app/page";
import { schedulerOptions } from "@/features/video/data";
import { MeetingScheduler } from "@/features/video/scheduler";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { isHostLike, loadMeeting } from "@/server/services/video/access";

export const metadata: Metadata = { title: "Edit meeting" };

export default async function EditMeetingPage({ params }: { params: Promise<{ publicId: string }> }) {
  const ctx = await requirePageAuth();
  const m = await loadMeeting((await params).publicId).catch(() => null);
  if (!m || !isHostLike(ctx, m)) notFound();
  if (!["DRAFT", "SCHEDULED", "FAILED"].includes(m.status)) notFound();
  const o = await schedulerOptions(ctx);
  const tz = m.timezone;
  const part = (d: Date, opt: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, ...opt }).format(d);
  const hm = (d: Date) => part(d, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const users = await db.user.findMany({ where: { id: { in: m.participants.filter((p) => p.userId && p.role !== "HOST" && !p.guestId && p.connectionStatus !== "REMOVED").map((p) => p.userId!) } }, select: { id: true, name: true, designation: true, studentProfile: { select: { studentNo: true } } } });
  const byId = new Map(users.map((u) => [u.id, u]));
  // Online classes add the class roll automatically; only extra people are listed for editing.
  const roll = m.offeringId ? new Set((await db.courseRegistration.findMany({ where: { offeringId: m.offeringId }, select: { student: { select: { userId: true } } } })).map((r) => r.student.userId)) : new Set<string | null>();
  const people = m.participants
    .filter((p) => p.userId && byId.has(p.userId) && !(roll.has(p.userId) && p.role === "PARTICIPANT"))
    .map((p) => { const u = byId.get(p.userId!)!; return { id: u.id, name: u.name, subtitle: u.studentProfile ? `Student · ${u.studentProfile.studentNo}` : u.designation ?? "", role: p.role === "CO_HOST" || p.role === "PRESENTER" ? p.role : "PARTICIPANT", panelRole: p.panelRole ?? "" }; });
  return (
    <div className="space-y-6">
      <PageHeader title={`Edit: ${m.title}`} breadcrumbs={[{ label: "Meetings", href: "/video" }, { label: m.publicId, href: `/video/${m.publicId}` }, { label: "Edit" }]} description="Changing the time tells everyone invited; newly added people receive an invitation." />
      <Section title="Details">
        <MeetingScheduler
          types={o.types.some((t) => t.id === m.meetingType) ? o.types : [...o.types, { id: m.meetingType, label: m.meetingType }]} offerings={o.offerings} mentees={o.mentees} departments={o.departments} recordingAvailable={o.recordingAvailable} timezone={tz}
          initial={{
            id: m.id, title: m.title, description: m.description ?? "", meetingType: m.meetingType, offeringId: m.offeringId ?? "", mentoringStudentId: m.mentoringStudentId ?? "", departmentId: m.departmentId ?? "",
            date: part(m.scheduledStart, { year: "numeric", month: "2-digit", day: "2-digit" }), start: hm(m.scheduledStart), end: hm(m.scheduledEnd), visibility: m.visibility, people,
            lobbyEnabled: m.lobbyEnabled, recordingEnabled: m.recordingEnabled, autoRecord: m.autoRecord, chatEnabled: m.chatEnabled, screenShareEnabled: m.screenShareEnabled, participantsCanPublish: m.participantsCanPublish, recordingAccess: m.recordingAccess,
          }}
        />
      </Section>
    </div>
  );
}
