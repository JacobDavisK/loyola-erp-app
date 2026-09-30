import { Megaphone, Pin } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { EmptyState, PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/features/academic-ops/controls";
import { publishAnnouncementAction, withdrawAnnouncementAction } from "@/features/campus/actions";
import { fmtDateTime } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { visibleAnnouncements } from "@/server/services/announcements";
import { aiStatus } from "@/server/ai/gateway";
import { AnnouncementDraft } from "@/features/insight/ai-controls";

export const metadata: Metadata = { title: "Announcements" };

const AUDIENCE = { EVERYONE: "Everyone", STAFF: "Staff", STUDENTS: "Students", GUARDIANS: "Parents & guardians" } as const;

export default async function AnnouncementsPage() {
  const ctx = await requirePageAuth();
  const publisher = can(ctx, "announcement.publish");
  const [mine, all, departments, programs] = await Promise.all([
    visibleAnnouncements(ctx),
    publisher ? db.announcement.findMany({ orderBy: { publishAt: "desc" }, take: 50, include: { author: { select: { name: true } }, department: { select: { code: true } }, program: { select: { code: true } } } }) : [],
    publisher ? db.department.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }) : [],
    publisher ? db.program.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" } }) : [],
  ]);
  const now = new Date();
  const ai = publisher ? await aiStatus() : null;
  return (
    <div className="space-y-6">
      <PageHeader title="Announcements" actions={publisher && (
        <FormDialog title="Announcement" columns={2} action={publishAnnouncementAction} submitLabel="Publish" initial={{ audience: "EVERYONE", pinned: false }} trigger={<Button size="sm"><Megaphone /> Announce</Button>}
          fields={[
            { name: "title", label: "Title", type: "text", wide: true },
            { name: "body", label: "Message", type: "textarea" },
            { name: "audience", label: "Audience", type: "select", options: Object.entries(AUDIENCE).map(([value, label]) => ({ value, label })) },
            { name: "departmentId", label: "Only this department (students/guardians)", type: "select", optional: true, options: departments.map((d) => ({ value: d.id, label: d.name })) },
            { name: "programId", label: "Only this programme (students/guardians)", type: "select", optional: true, options: programs.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` })) },
            { name: "publishAt", label: "Publish at (empty = now)", type: "datetime-local", optional: true },
            { name: "expiresAt", label: "Expires at", type: "datetime-local", optional: true },
            { name: "pinned", label: "Important: pin to the top and also e-mail", type: "checkbox", wide: true },
          ]} />
      )} />
      {mine.length === 0 ? <EmptyState icon={Megaphone} title="No announcements" /> : (
        <div className="space-y-3">
          {mine.map((a) => (
            <article key={a.id} className="surface-card p-5">
              <h2 className="flex items-center gap-2 font-semibold">{a.pinned && <Pin className="size-4 text-primary" aria-label="Pinned" />}{a.title}</h2>
              <p className="text-xs text-muted-foreground">{a.author.name} · {fmtDateTime(a.publishAt)}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm">{a.body}</p>
            </article>
          ))}
        </div>
      )}
      {ai && ai.configured && ai.enabled && ai.features.announcementDrafts && <Section title="Draft with AI" description="Turn key points into a clear announcement. Review every fact before publishing."><AnnouncementDraft /></Section>}
      {publisher && (
        <Section title="All announcements (management)" bodyClassName="p-0">
          <DataTable head={[{ label: "Title" }, { label: "Audience" }, { label: "Published" }, { label: "Expires" }, { label: "" }]}>
            {all.map((a) => {
              const live = a.publishAt <= now && (!a.expiresAt || a.expiresAt > now);
              return (
                <tr key={a.id}>
                  <Td>{a.title}</Td>
                  <Td className="text-xs">{AUDIENCE[a.audience]}{a.department ? ` · ${a.department.code}` : ""}{a.program ? ` · ${a.program.code}` : ""}</Td>
                  <Td className="text-xs">{fmtDateTime(a.publishAt)}{a.publishAt > now ? " (scheduled)" : ""}</Td>
                  <Td className="text-xs">{a.expiresAt ? fmtDateTime(a.expiresAt) : "—"}</Td>
                  <Td className="text-right">{live && <ActionButton size="xs" variant="ghost" label="Withdraw" run={withdrawAnnouncementAction.bind(null, a.id)} confirmText="Withdraw this announcement now?" />}</Td>
                </tr>
              );
            })}
          </DataTable>
        </Section>
      )}
    </div>
  );
}
