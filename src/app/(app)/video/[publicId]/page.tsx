import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardCheck, Copy, Download, Pencil, Send } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, LinkTabs, Td } from "@/components/app/list";
import { KeyValue, PageHeader, Section, StatCard } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/features/academic-ops/controls";
import { PromptButton } from "@/features/finance/controls";
import {
  addNoteAction, adjustAttendanceAction, applyToRegisterAction, cancelMeetingAction, deleteRecordingAction, duplicateMeetingAction, publishDraftAction, removeParticipantAction, revokeGuestAction, updateRecordingAction,
} from "@/features/video/actions";
import { GuestInviteDialog, MeetingPrimaryButton, RecordingPlayer, RespondButtons } from "@/features/video/controls";
import { joinWindowOpen, MEETING_TYPES, NOTE_KINDS, type MeetingStatus, type MeetingType } from "@/lib/domain/video";
import { fmtDateTimeZoned } from "@/lib/format";
import { can, isSuperAdmin, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { getInstitution } from "@/server/services/directory";
import { getSetting } from "@/server/services/settings";
import { canSee, isHostLike, isModerator, loadMeeting, myParticipant } from "@/server/services/video/access";
import { meetingAnalytics } from "@/server/services/video/analytics";
import { canViewAttendance, meetingAttendance } from "@/server/services/video/attendance";
import { chatHistory } from "@/server/services/video/chat";
import { meetingNotes } from "@/server/services/video/meetings";
import { recordingsFor } from "@/server/services/video/recordings";

export const metadata: Metadata = { title: "Meeting" };

const ROLE: Record<string, string> = { HOST: "Host", CO_HOST: "Co-host", PRESENTER: "Presenter", PARTICIPANT: "Participant", MODERATOR: "Moderator", OBSERVER: "Observer" };
const ACCESS: Record<string, string> = { HOST_ONLY: "Host and co-hosts", PARTICIPANTS: "Participants", COURSE: "The class", DEPARTMENT: "The department", SPECIFIC: "Specific people", ADMINS: "Host and administrators" };

export default async function MeetingPage({ params, searchParams }: { params: Promise<{ publicId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePageAuth();
  const { publicId } = await params;
  const m = await loadMeeting(publicId).catch(() => null);
  if (!m || !(await canSee(ctx, m))) notFound();
  const [{ timezone }, s] = await Promise.all([getInstitution(), getSetting("video")]);
  const host = isHostLike(ctx, m);
  const moderator = isModerator(ctx, m);
  const mine = myParticipant(ctx, m);
  const status = m.status as MeetingStatus;
  const now = new Date();
  const type = MEETING_TYPES[m.meetingType as MeetingType];
  const showAttendance = canViewAttendance(ctx, m) || !!mine;
  const showNotes = m.meetingType in NOTE_KINDS && (host || (!!mine?.panelRole && mine.panelRole !== "CANDIDATE"));
  const showChat = host && (status === "ENDED" || status === "LIVE") && m.chatEnabled;
  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "people", label: `Participants (${m.participants.filter((p) => p.connectionStatus !== "REMOVED").length})` },
    ...(showAttendance && (status === "ENDED" || status === "LIVE") ? [{ key: "attendance", label: "Attendance" }] : []),
    ...(m.recordingEnabled || status === "ENDED" ? [{ key: "recordings", label: "Recordings" }] : []),
    ...(showNotes ? [{ key: "notes", label: m.meetingType === "VIVA_VOCE" ? "Examiner notes" : m.meetingType === "PHD_REVIEW" ? "Review notes" : "Notes" }] : []),
    ...(showChat ? [{ key: "chat", label: "Chat" }] : []),
  ].map((x) => ({ ...x, href: `?tab=${x.key}` }));
  const requested = (await searchParams).tab ?? "overview";
  const tab = tabs.some((x) => x.key === requested) ? requested : "overview";
  const open = joinWindowOpen(now, m.scheduledStart, m.scheduledEnd, status, s.joinEarlyMinutes);
  const action = mine?.connectionStatus === "REMOVED" ? null : status === "LIVE" || status === "STARTING" ? (host ? "enter" : "join") : host && open && (status === "SCHEDULED" || status === "FAILED") ? "start" : null;
  const hostUser = await db.user.findUnique({ where: { id: m.hostUserId }, select: { name: true } });
  const offering = m.offeringId ? await db.courseOffering.findUnique({ where: { id: m.offeringId }, include: { course: { select: { code: true, title: true } } } }) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${type.label} · ${m.publicId}`}
        title={m.title}
        breadcrumbs={[{ label: "Meetings", href: "/video" }, { label: m.publicId }]}
        description={`${fmtDateTimeZoned(m.scheduledStart, timezone)} – ${fmtDateTimeZoned(m.scheduledEnd, timezone).slice(-5)} · ${hostUser?.name ?? ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {action && <MeetingPrimaryButton meetingId={m.id} publicId={m.publicId} mode={action} size="default" />}
            {!action && status === "SCHEDULED" && !host && <span className="text-sm text-muted-foreground">You can join from {s.joinEarlyMinutes} minutes before the start.</span>}
            {host && status === "DRAFT" && <ActionButton label="Schedule" variant="default" icon={<Send />} run={publishDraftAction.bind(null, m.id)} confirmText="Schedule this meeting and send the invitations?" />}
            {host && ["DRAFT", "SCHEDULED", "FAILED"].includes(status) && <Button size="sm" variant="outline" asChild><Link href={`/video/${m.publicId}/edit`}><Pencil /> Edit</Link></Button>}
            {host && <ActionButton label="Duplicate" icon={<Copy />} run={duplicateMeetingAction.bind(null, m.id)} />}
            {host && ["DRAFT", "SCHEDULED", "FAILED"].includes(status) && <PromptButton label="Cancel meeting" destructive question="Why is the meeting cancelled? Participants are told." action={cancelMeetingAction.bind(null, m.id)} />}
          </div>
        }
      />

      {status === "FAILED" && host && <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">The meeting could not start{m.failureReason ? `: ${m.failureReason}` : "."} You can try again.</div>}
      {status === "CANCELLED" && <div role="status" className="rounded-xl border bg-muted/40 px-4 py-3 text-sm">This meeting was cancelled{m.cancelReason ? `: ${m.cancelReason}` : "."}</div>}

      <LinkTabs tabs={tabs} active={tab} />

      {tab === "overview" && <Overview />}
      {tab === "people" && <People />}
      {tab === "attendance" && <Attendance />}
      {tab === "recordings" && <Recordings />}
      {tab === "notes" && <Notes />}
      {tab === "chat" && <Chat />}
    </div>
  );

  async function Overview() {
    const analytics = canViewAttendance(ctx, m!) && status === "ENDED" ? await meetingAnalytics(ctx, m!.id) : null;
    return (
      <div className="space-y-6">
        {analytics && (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
            <StatCard label="Duration" value={`${analytics.durationMinutes} min`} />
            <StatCard label="Joined" value={`${analytics.joined} / ${analytics.invited + 1}`} />
            <StatCard label="Peak at once" value={analytics.peak} />
            <StatCard label="Average attendance" value={`${analytics.averageAttendance}%`} hint={`${analytics.present} present · ${analytics.partial} partly · ${analytics.absent} absent`} />
          </div>
        )}
        <Section title="Details">
          <KeyValue items={[
            ["Status", status.toLowerCase()],
            ["Type", type.label],
            ["Host", hostUser?.name ?? "—"],
            ...(offering ? [["Class", `${offering.course.code}-${offering.section} ${offering.course.title}`] as [string, string]] : []),
            ["Scheduled", `${fmtDateTimeZoned(m!.scheduledStart, timezone)} – ${fmtDateTimeZoned(m!.scheduledEnd, timezone)} (${timezone})`],
            ...(m!.actualStart ? [["Held", `${fmtDateTimeZoned(m!.actualStart, timezone)}${m!.actualEnd ? ` – ${fmtDateTimeZoned(m!.actualEnd, timezone)}` : " (live)"}`] as [string, string]] : []),
            ["Who can join", m!.visibility === "INVITED" ? "Only invited people" : m!.visibility === "COURSE" ? "The class" : m!.visibility === "DEPARTMENT" ? "The department" : "Anyone at the university"],
            ["Settings", [m!.lobbyEnabled && "lobby", m!.chatEnabled && "chat", m!.screenShareEnabled && "screen sharing", m!.recordingEnabled && `recording (${ACCESS[m!.recordingAccess]})`].filter(Boolean).join(" · ") || "—"],
            ...(m!.description ? [["Description", <span key="d" className="whitespace-pre-wrap">{m!.description}</span>] as [string, React.ReactNode]] : []),
          ]} />
        </Section>
        {mine && mine.role !== "HOST" && status === "SCHEDULED" && (
          <Section title="Your response"><RespondButtons meetingId={m!.id} current={mine.invitationStatus} /></Section>
        )}
        {host && status === "ENDED" && m!.classMeetingId && (
          <Section title="Class register" description="Copy the measured attendance into this class session's register (present, late for partial attendance, absent).">
            <ActionButton label="Copy to the class register" icon={<ClipboardCheck />} run={applyToRegisterAction.bind(null, m!.id)} confirmText="Copy the video attendance into the class register?" />
          </Section>
        )}
        {host && m!.meetingType === "STUDENT_MENTORING" && status === "ENDED" && m!.mentoringStudentId && (
          <Section title="Mentoring record" description="Record what was discussed and the agreed actions in the student's mentoring file.">
            <Button size="sm" variant="outline" asChild><Link href={`/mentoring?student=${m!.mentoringStudentId}&online=${m!.publicId}`}>Log this session</Link></Button>
          </Section>
        )}
      </div>
    );
  }

  async function People() {
    const guests = host ? await db.videoMeetingGuest.findMany({ where: { meetingId: m!.id }, orderBy: { createdAt: "asc" } }) : [];
    const visible = m!.participants.filter((p) => (moderator ? true : p.connectionStatus !== "REMOVED")).sort((a, b) => ["HOST", "CO_HOST", "PRESENTER", "MODERATOR", "PARTICIPANT", "OBSERVER"].indexOf(a.role) - ["HOST", "CO_HOST", "PRESENTER", "MODERATOR", "PARTICIPANT", "OBSERVER"].indexOf(b.role) || a.displayName.localeCompare(b.displayName));
    return (
      <div className="space-y-6">
        <Section title="Participants" actions={host && status !== "ENDED" && status !== "CANCELLED" ? <div className="flex gap-2">{s.guestAccessEnabled && <GuestInviteDialog meetingId={m!.id} />}<Button size="xs" variant="outline" asChild><Link href={`/video/${m!.publicId}/edit`}>Invite people</Link></Button></div> : undefined} bodyClassName="p-0">
          <DataTable head={[{ label: "Name" }, { label: "Role" }, { label: "Response" }, { label: "Status" }, { label: "" }]}>
            {visible.map((p) => (
              <tr key={p.id} className={p.connectionStatus === "REMOVED" ? "opacity-50" : undefined}>
                <Td className="font-medium">{p.displayName}{p.userId === ctx.user.id ? " (you)" : ""}</Td>
                <Td className="text-xs">{ROLE[p.role]}{p.panelRole ? ` · ${p.panelRole.toLowerCase().replace(/_/g, " ")}` : ""}</Td>
                <Td className="text-xs">{p.role === "HOST" ? "—" : p.invitationStatus.toLowerCase()}</Td>
                <Td className="text-xs">{p.connectionStatus === "CONNECTED" ? "in the meeting" : p.connectionStatus === "IN_LOBBY" ? "waiting in lobby" : p.connectionStatus === "REMOVED" ? "removed" : p.lastJoinedAt ? "left" : "—"}</Td>
                <Td className="text-right">{moderator && p.role !== "HOST" && p.connectionStatus !== "REMOVED" && status !== "ENDED" && <ActionButton label="Remove" size="xs" variant="ghost" run={removeParticipantAction.bind(null, m!.id, p.id)} confirmText={`Remove ${p.displayName}? They will not be able to rejoin.`} />}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
        {guests.length > 0 && (
          <Section title="Guest links" bodyClassName="p-0">
            <DataTable head={[{ label: "Guest" }, { label: "Valid until" }, { label: "Last used" }, { label: "" }]}>
              {guests.map((g) => (
                <tr key={g.id} className={g.revokedAt ? "opacity-50" : undefined}>
                  <Td>{g.name}<div className="text-xs text-muted-foreground">{g.email}</div></Td>
                  <Td className="text-xs">{g.revokedAt ? "withdrawn" : fmtDateTimeZoned(g.expiresAt, timezone)}</Td>
                  <Td className="text-xs">{g.lastUsedAt ? fmtDateTimeZoned(g.lastUsedAt, timezone) : "—"}</Td>
                  <Td className="text-right">{!g.revokedAt && <ActionButton label="Withdraw" size="xs" variant="ghost" run={revokeGuestAction.bind(null, m!.id, g.id)} confirmText="Withdraw this guest link?" />}</Td>
                </tr>
              ))}
            </DataTable>
          </Section>
        )}
      </div>
    );
  }

  async function Attendance() {
    const a = await meetingAttendance(ctx, m!.id);
    const canAdjust = can(ctx, "video.modify_attendance", m!.departmentId ?? undefined) && canViewAttendance(ctx, m!) && status === "ENDED";
    return (
      <Section
        title="Attendance"
        description={`Measured from when each person was connected, against the ${a.rows.length && m!.actualStart ? "actual" : "scheduled"} meeting time. Present at ${s.attendancePresentPercent}% or more; partly present from ${s.attendancePartialMinMinutes} minutes.`}
        actions={canViewAttendance(ctx, m!) && a.rows.length ? <Button size="xs" variant="outline" asChild><a href={`/api/video/meetings/${m!.id}/attendance?format=csv`}><Download /> CSV</a></Button> : undefined}
        bodyClassName="p-0"
      >
        <DataTable head={[{ label: "Name" }, { label: "Minutes", className: "text-right" }, { label: "Attendance", className: "text-right" }, { label: "Status" }, { label: "Joined / left" }, { label: "" }]} empty={status === "LIVE" ? "Attendance is worked out when the meeting ends." : "No attendance recorded."}>
          {a.rows.map((r) => (
            <tr key={r.id}>
              <Td className="font-medium">{r.participant.displayName}<div className="text-[11px] text-muted-foreground">{ROLE[r.participant.role]}</div></Td>
              <Td className="text-right tabular-nums">{Math.round(r.totalSeconds / 60)}</Td>
              <Td className="text-right tabular-nums">{r.attendancePercentage}%</Td>
              <Td className="text-xs">{r.attendanceStatus.toLowerCase().replace("_", " ")}{r.manuallyAdjusted && <div className="text-[11px] text-muted-foreground">corrected: {r.adjustmentReason}</div>}</Td>
              <Td className="text-xs">{r.firstJoinedAt ? fmtDateTimeZoned(r.firstJoinedAt, timezone).slice(-5) : "—"}{r.lastLeftAt ? ` – ${fmtDateTimeZoned(r.lastLeftAt, timezone).slice(-5)}` : ""}</Td>
              <Td className="text-right">{canAdjust && <FormDialog title="Attendance correction" id={r.id} action={adjustAttendanceAction} submitLabel="Correct" initial={{ status: r.attendanceStatus }} fields={[{ name: "status", label: "Status", type: "select", options: [{ value: "PRESENT", label: "Present" }, { value: "PARTIALLY_PRESENT", label: "Partly present" }, { value: "ABSENT", label: "Absent" }] }, { name: "reason", label: "Reason (recorded in the audit log)", type: "textarea" }]} />}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    );
  }

  async function Recordings() {
    const { recordings, manage } = await recordingsFor(ctx, m!.id);
    const canDownload = s.allowRecordingDownload || host || isSuperAdmin(ctx);
    const canDelete = can(ctx, "video.delete_recording", m!.departmentId ?? undefined);
    return (
      <Section title="Recordings" description={m!.recordingEnabled ? `Not public: ${ACCESS[m!.recordingAccess].toLowerCase()} can watch, through this page only. Kept for ${s.recordingRetentionDays} days.` : "Recording was not allowed for this meeting."}>
        {!recordings.length ? <p className="text-sm text-muted-foreground">{status === "LIVE" ? "Recordings appear here after the meeting." : "No recordings."}</p> : (
          <div className="space-y-6">
            {recordings.map((r, i) => (
              <article key={r.id} className="space-y-3">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-medium">Recording {i + 1}</span>
                  <span className="text-muted-foreground">{fmtDateTimeZoned(r.startedAt, timezone)}{r.durationSeconds ? ` · ${Math.round(r.durationSeconds / 60)} min` : ""}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{r.status === "AVAILABLE" ? "available" : r.status === "ARCHIVED" ? "archived" : r.status === "FAILED" ? "failed" : "being processed"}</span>
                  {manage && <span className="text-xs text-muted-foreground">Visible to: {ACCESS[r.access]}</span>}
                </div>
                {(r.status === "AVAILABLE" || r.status === "ARCHIVED") && <RecordingPlayer recordingId={r.id} canDownload={canDownload} />}
                {r.status === "PROCESSING" && <p className="text-sm text-muted-foreground">Recording is currently being processed.</p>}
                {manage && r.status !== "FAILED" && (
                  <div className="flex flex-wrap gap-2">
                    <FormDialog title="Recording access" id={r.id} action={async (id, v) => { "use server"; return updateRecordingAction(id!, v); }} submitLabel="Save" initial={{ access: r.access }} trigger={<Button size="xs" variant="outline">Share…</Button>}
                      fields={[{ name: "access", label: "Who can watch", type: "select", options: Object.entries(ACCESS).filter(([k]) => k !== "SPECIFIC" && (k !== "COURSE" || m!.offeringId)).map(([value, label]) => ({ value, label })) }]} />
                    {r.status === "AVAILABLE" && <ActionButton label="Archive" size="xs" run={updateRecordingAction.bind(null, r.id, { archived: true })} confirmText="Archive this recording? Only hosts and administrators will see it." />}
                    {r.status === "ARCHIVED" && <ActionButton label="Restore" size="xs" run={updateRecordingAction.bind(null, r.id, { archived: false })} />}
                    {canDelete && <PromptButton label="Delete" destructive question="Why is this recording being deleted? The file is removed permanently." action={deleteRecordingAction.bind(null, r.id)} />}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </Section>
    );
  }

  async function Notes() {
    const notes = await meetingNotes(ctx, m!.id);
    const kinds = NOTE_KINDS[m!.meetingType as keyof typeof NOTE_KINDS];
    return (
      <Section title="Notes" description="Visible to the host and the panel only — never to the candidate or mentee." actions={<FormDialog title="Note" id={m!.id} action={addNoteAction} submitLabel="Save note" initial={{ kind: kinds[0] }} trigger={<Button size="xs">Add note</Button>} fields={[{ name: "kind", label: "Kind", type: "select", options: kinds.map((k) => ({ value: k, label: k.toLowerCase().replace(/_/g, " ") })) }, { name: "body", label: "Note", type: "textarea" }, { name: "followUpOn", label: "Follow-up date (optional)", type: "date", optional: true }]} />}>
        {notes.length ? (
          <ol className="space-y-4">
            {notes.map((n) => (
              <li key={n.id} className="border-l-2 pl-4">
                <div className="text-xs text-muted-foreground">{n.kind.toLowerCase().replace(/_/g, " ")} · {n.author} · {fmtDateTimeZoned(n.createdAt, timezone)}{n.followUpOn ? ` · follow up ${n.followUpOn.toISOString().slice(0, 10)}` : ""}</div>
                <p className="mt-1 text-sm whitespace-pre-wrap">{n.body}</p>
              </li>
            ))}
          </ol>
        ) : <p className="text-sm text-muted-foreground">No notes yet.</p>}
      </Section>
    );
  }

  async function Chat() {
    const lines = await chatHistory(ctx, m!.id);
    return (
      <Section title="Chat transcript" description={`Kept for ${s.chatRetentionDays} days after the meeting.`}>
        {lines.length ? <ul className="space-y-2 text-sm">{lines.map((l) => <li key={l.id}><span className="text-xs text-muted-foreground">{fmtDateTimeZoned(l.at, timezone).slice(-5)}</span> <span className="font-medium">{l.sender}:</span> <span className="whitespace-pre-wrap">{l.message}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">No messages.</p>}
      </Section>
    );
  }
}
