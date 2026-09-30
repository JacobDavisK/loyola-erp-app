import { ClipboardList } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DataTable, Td } from "@/components/app/list";
import { EmptyState, PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { selfRegisterAction } from "@/features/academic-ops/actions";
import { ActionButton } from "@/features/academic-ops/controls";
import { DropButton } from "@/features/academic-ops/offering-panels";
import { REGISTRATION_STATUS } from "@/lib/domain/labels";
import { DAY_NAMES } from "@/lib/domain/timetable";
import { fmtDateTime } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { registrationCatalogue } from "@/server/services/offerings";
import { getSetting } from "@/server/services/settings";

export const metadata: Metadata = { title: "Course registration" };

export default async function PortalRegistrationPage() {
  const ctx = await requirePageAuth("enrollment.self");
  if (!ctx.subject.studentId) redirect("/portal");
  const [{ term, offerings, mine }, academic] = await Promise.all([registrationCatalogue(ctx), getSetting("academic")]);
  if (!term) return <div><PageHeader title="Course registration" /><EmptyState icon={ClipboardList} title="Registration is not open" description="You will be notified when course registration opens." /></div>;
  const now = new Date();
  const closes = term.addDropUntil ?? term.registrationClosesAt;
  const open = (!term.registrationOpensAt || now >= term.registrationOpensAt) && (!closes || now <= closes);
  const active = mine.filter((r) => r.status === "REGISTERED");
  const credits = active.reduce((a, r) => a + r.offering.course.credits, 0);
  const registeredOfferings = new Set(active.map((r) => r.offeringId));
  const registeredCourses = new Set(active.map((r) => r.offering.courseId));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Course registration"
        description={`${term.name} · ${open ? `open${closes ? ` until ${fmtDateTime(closes)}` : ""}` : term.registrationOpensAt && now < term.registrationOpensAt ? `opens ${fmtDateTime(term.registrationOpensAt)}` : "closed"} · ${credits} of at most ${academic.maxCreditsPerTerm} credits`}
      />
      <Section title="My courses this term" bodyClassName="p-0">
        {mine.length === 0 ? <p className="px-5 py-4 text-sm text-muted-foreground">You have not registered for any course yet.</p> : (
          <DataTable head={[{ label: "Course" }, { label: "Section" }, { label: "Credits", className: "text-right" }, { label: "Status" }, { label: "" }]}>
            {mine.map((r) => (
              <tr key={r.id}>
                <Td><span className="font-mono text-xs text-muted-foreground">{r.offering.course.code}</span> {r.offering.course.title}</Td>
                <Td className="text-xs">{r.offering.section}</Td>
                <Td className="text-right tabular">{r.offering.course.credits}</Td>
                <Td><StatusBadge meta={REGISTRATION_STATUS[r.status]} /></Td>
                <Td className="text-right">{open && r.status === "REGISTERED" && can(ctx, "enrollment.self") && <DropButton registrationId={r.id} />}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
      <Section title="Available classes" description="Eligibility (prerequisites, credit limit, timetable clashes, seats) is checked when you register." bodyClassName="p-0">
        {offerings.length === 0 ? <p className="px-5 py-4 text-sm text-muted-foreground">No classes are open for registration.</p> : (
          <DataTable head={[{ label: "Course" }, { label: "Schedule" }, { label: "Instructor" }, { label: "Seats", className: "text-right" }, { label: "" }]}>
            {offerings.map((o) => {
              const full = o._count.registrations >= o.capacity;
              return (
                <tr key={o.id}>
                  <Td><span className="font-mono text-xs text-muted-foreground">{o.course.code}-{o.section}</span> <span className="font-medium">{o.course.title}</span><div className="text-[11px] text-muted-foreground">{o.course.credits} credits · {o.course.courseType.replace("_", " ").toLowerCase()}</div></Td>
                  <Td className="text-xs">{o.slots.map((sl) => `${DAY_NAMES[sl.dayOfWeek].slice(0, 3)} ${sl.startTime}`).join(", ") || "—"}</Td>
                  <Td className="text-xs">{o.instructors.map((i) => i.user.name).join(", ") || "—"}</Td>
                  <Td className="text-right text-xs tabular">{Math.max(0, o.capacity - o._count.registrations)} left</Td>
                  <Td className="text-right">
                    {registeredOfferings.has(o.id) ? <span className="text-xs text-tone-success">Registered</span>
                      : registeredCourses.has(o.courseId) ? <span className="text-xs text-muted-foreground">Other section</span>
                      : open && !full ? <ActionButton size="xs" run={selfRegisterAction.bind(null, o.id)} label="Register" />
                      : <span className="text-xs text-muted-foreground">{full ? "Full" : "Closed"}</span>}
                  </Td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Section>
    </div>
  );
}
