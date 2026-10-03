import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, ClipboardCheck, GraduationCap, Percent, Video, Wallet } from "lucide-react";
import { formatMoney } from "@/lib/domain/money";
import { studentBalance } from "@/server/services/finance-core";
import type { Metadata } from "next";
import { EmptyState, PageHeader, Section, StatCard } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { WeekGrid } from "@/components/app/week-grid";
import { Progress } from "@/components/ui/progress";
import { STANDING_LABEL } from "@/lib/domain/attendance";
import { STUDENT_STATUS } from "@/lib/domain/labels";
import { isoWeekday } from "@/lib/domain/timetable";
import { fmtDate, fmtDateTime, fmtDateTimeZoned, fmtDayZoned, fmtTime } from "@/lib/format";
import { meetingList } from "@/features/video/data";
import { cn } from "@/lib/utils";
import { can, isSuperAdmin, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { currentTerm } from "@/server/services/academic-setup";
import { studentAttendance } from "@/server/services/attendance";
import { degreeProgress } from "@/server/services/curriculum";
import { getInstitution } from "@/server/services/directory";
import { portalSubject } from "@/server/services/portal";
import { getT } from "@/server/i18n";

export const metadata: Metadata = { title: "My portal" };

function greeting(tz: string) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: tz }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function PortalPage({ searchParams }: { searchParams: Promise<{ student?: string }> }) {
  const ctx = await requirePageAuth("self.portal");
  if (ctx.user.userType === "STAFF" && !isSuperAdmin(ctx)) redirect("/dashboard");
  const sp = await searchParams;
  const t = await getT();
  const subject = await portalSubject(ctx, sp.student);
  const s = subject.student;
  const [inst, term] = await Promise.all([getInstitution(), currentTerm()]);
  const now = new Date();
  const todayYmd = new Intl.DateTimeFormat("en-CA", { timeZone: inst.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [att, progress, slots, todays, events] = await Promise.all([
    term && subject.canAcademic ? studentAttendance(ctx, s.id, term.id) : null,
    subject.canAcademic ? degreeProgress(ctx, s.id) : null,
    term ? db.timetableSlot.findMany({ where: { offering: { termId: term.id, status: { not: "CANCELLED" }, registrations: { some: { studentId: s.id, status: "REGISTERED" } } } }, include: { room: { select: { code: true } }, offering: { select: { section: true, course: { select: { code: true, title: true } } } } } }) : [],
    db.classMeeting.findMany({ where: { date: new Date(`${todayYmd}T00:00:00Z`), status: { not: "CANCELLED" }, offering: { registrations: { some: { studentId: s.id, status: "REGISTERED" } } } }, include: { room: { select: { code: true } }, videoMeeting: { select: { publicId: true, status: true } }, offering: { select: { course: { select: { code: true, title: true } } } } }, orderBy: { startsAt: "asc" } }),
    db.calendarEvent.findMany({ where: { endDate: { gte: new Date(`${todayYmd}T00:00:00Z`) }, startDate: { lte: new Date(now.getTime() + 45 * 86_400_000) } }, orderBy: { startDate: "asc" }, take: 6 }),
  ]);
  const online = subject.isSelf && can(ctx, "video.join") ? await meetingList(ctx, "upcoming", {}, 5) : [];
  const fees = subject.canFinance ? await db.$transaction((tx) => studentBalance(tx, s.id)) : { outstanding: 0, overdue: 0 };
  const shortage = att?.classes.filter((c) => c.summary.standing === "SHORTAGE" || c.summary.standing === "CONDONABLE") ?? [];
  const regOpen = term && term.status === "REGISTRATION" && (!term.registrationClosesAt || term.registrationClosesAt > now);
  const qs = subject.isSelf ? "" : `?student=${s.id}`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={fmtDayZoned(now, inst.timezone)}
        title={subject.isSelf ? `${t(greeting(inst.timezone))}, ${s.firstName}` : `${s.firstName} ${s.lastName}`}
        description={<span className="flex flex-wrap items-center gap-2">{s.program.name} · {s.batch.code} · {t("Semester")} {s.currentSemester} <StatusBadge meta={STUDENT_STATUS[s.status as keyof typeof STUDENT_STATUS]} /></span>}
        actions={
          subject.viewAs ? (
            <form className="flex gap-2">
              <input name="student" defaultValue={s.studentNo} aria-label={t("Student number")} className="h-8 w-36 rounded-lg border bg-card px-2 font-mono text-[13px] uppercase" />
              <button className="h-8 rounded-lg border px-3 text-[13px] hover:bg-muted">{t("View portal")}</button>
            </form>
          ) : subject.wards.length > 1 ? (
            <form className="flex gap-2">
              <select name="student" defaultValue={s.id} aria-label={t("Choose student")} className="h-8 rounded-lg border bg-card px-2 text-[13px]">{subject.wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
              <button className="h-8 rounded-lg border px-3 text-[13px] hover:bg-muted">{t("Show")}</button>
            </form>
          ) : null
        }
      />

      {!subject.canAcademic ? (
        <EmptyState icon={GraduationCap} title={t("Academic information is not shared with this account")} description="The institution controls what each guardian can see. Contact the student's department to change it." />
      ) : (
        <>
          {regOpen && subject.isSelf && (
            <Link href="/portal/registration" className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm hover:bg-primary/10">
              <ClipboardCheck className="size-5 text-primary" />
              <span className="flex-1"><b>{t("Course registration is open")}</b> for {term!.name}{term!.registrationClosesAt ? ` until ${fmtDateTime(term!.registrationClosesAt)}` : ""}.</span>
              <span className="font-medium text-primary">{t("Register →")}</span>
            </Link>
          )}
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
            <StatCard label={t("Attendance this term")} value={att?.overallPercent !== null && att?.overallPercent !== undefined ? `${att.overallPercent}%` : "—"} icon={Percent} tone={shortage.length ? "warning" : undefined} hint={att ? `${t("Minimum")} ${att.policy.minimumPercent}%` : undefined} href={`/portal/attendance${qs}`} />
            <StatCard label={t("Credits earned")} value={progress ? `${progress.audit.earnedCredits} / ${progress.audit.requiredCredits}` : "—"} icon={GraduationCap} hint={progress ? `${progress.audit.percent}% of the degree` : "No curriculum set"} />
            <StatCard label={t("Classes this term")} value={att?.classes.length ?? 0} icon={CalendarDays} />
            {subject.canFinance && <StatCard label={t("Fees outstanding")} value={formatMoney(fees.outstanding, inst.currency, inst.locale)} icon={Wallet} tone={fees.overdue ? "danger" : undefined} hint={fees.overdue ? `${fees.overdue} invoice(s) overdue` : fees.outstanding ? t("Pay by the due date") : t("Nothing due")} href={`/portal/fees${qs}`} />}
          </div>

          {shortage.length > 0 && (
            <Section title={t("Attendance needs attention")}>
              <ul className="space-y-2 text-sm">
                {shortage.map((c) => (
                  <li key={c.offeringId} className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{c.code}</span> {c.title}
                    <span className={cn("font-medium", c.summary.standing === "SHORTAGE" ? "text-tone-danger" : "text-tone-warning")}>{c.summary.percent}% · {STANDING_LABEL[c.summary.standing]}</span>
                    {c.summary.mustAttend ? <span className="text-xs text-muted-foreground">attend the next {c.summary.mustAttend} classes to reach {att!.policy.minimumPercent}%</span> : null}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Section title={t("Today")}>
              {todays.length === 0 ? <p className="text-sm text-muted-foreground">{t("No classes today.")}</p> : (
                <ul className="divide-y">
                  {todays.map((m) => (
                    <li key={m.id} className={cn("flex items-center gap-3 py-2.5", m.endsAt < now && "opacity-60")}>
                      <span className="w-28 text-sm tabular">{fmtTime(m.startsAt, inst.timezone)}–{fmtTime(m.endsAt, inst.timezone)}</span>
                      <span className="flex-1 text-sm"><span className="font-mono text-xs text-muted-foreground">{m.offering.course.code}</span> {m.offering.course.title}</span>
                      {m.videoMeeting && subject.isSelf && m.videoMeeting.status !== "CANCELLED" && m.endsAt >= now ? <Link href={`/meet/${m.videoMeeting.publicId}`} className="text-xs font-medium text-primary hover:underline">{t("Join online")}</Link> : <span className="text-xs text-muted-foreground">{m.room?.code}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title={t("Coming up")}>
              {events.length === 0 ? <p className="text-sm text-muted-foreground">{t("Nothing on the calendar.")}</p> : (
                <ul className="space-y-2.5 text-sm">
                  {events.map((e) => <li key={e.id}><div className="font-medium">{e.title}</div><div className="text-xs text-muted-foreground">{fmtDate(e.startDate)}{e.endDate.getTime() !== e.startDate.getTime() ? ` – ${fmtDate(e.endDate)}` : ""}{e.isHoliday ? " · no classes" : ""}</div></li>)}
                </ul>
              )}
            </Section>
          </div>

          {online.length > 0 && (
            <Section title={t("Live classes & meetings")} actions={<Link href="/video" className="text-sm font-medium text-primary hover:underline">{t("All meetings")}</Link>}>
              <ul className="divide-y">
                {online.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                    <Video className="size-4 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1"><Link href={`/video/${m.publicId}`} className="font-medium hover:text-primary">{m.title}</Link><span className="block text-xs text-muted-foreground">{fmtDateTimeZoned(m.scheduledStart, inst.timezone)}{m.status === "LIVE" ? ` · ${t("Live now")}` : ""}</span></span>
                    {m.status === "LIVE" && <Link href={`/meet/${m.publicId}`} className="text-xs font-medium text-primary hover:underline">{t("Join")}</Link>}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title={t("Weekly timetable")} description={term?.name}>
            <WeekGrid highlightDay={isoWeekday(new Date(`${todayYmd}T00:00:00Z`))} items={slots.map((x) => ({ id: x.id, dayOfWeek: x.dayOfWeek, startTime: x.startTime, endTime: x.endTime, title: x.offering.course.code, subtitle: [x.offering.course.title, x.room?.code].filter(Boolean).join(" · "), tone: x.kind === "LAB" ? "lab" : "default" }))} />
          </Section>

          {progress && (
            <Section title={t("Degree progress")} description={`${progress.curriculum.name} v${progress.curriculum.version}`}>
              <div className="mb-2 flex items-end justify-between"><span className="text-2xl font-semibold tabular">{progress.audit.percent}%</span><span className="text-sm text-muted-foreground tabular">{progress.audit.earnedCredits} of {progress.audit.requiredCredits} credits</span></div>
              <Progress value={progress.audit.percent} aria-label={t("Degree progress")} />
              <p className="mt-3 text-sm text-muted-foreground">{progress.audit.mandatory.done} of {progress.audit.mandatory.total} mandatory courses completed{progress.audit.blockers.length ? ` · still needed: ${progress.audit.blockers.join("; ")}` : ""}.</p>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
