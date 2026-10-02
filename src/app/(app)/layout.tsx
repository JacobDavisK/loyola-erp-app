import { I18nProvider } from "@/components/i18n";
import { AppShell } from "@/components/shell/app-shell";
import { dictionary, translate } from "@/lib/i18n";
import type { PaletteCommand } from "@/components/shell/command-palette";
import { NAV, type NavGroup } from "@/components/shell/nav";
import { can, canAny, requirePageAuth, isSuperAdmin } from "@/server/auth/current";
import Link from "next/link";
import { cookies } from "next/headers";
import { ShieldAlert } from "lucide-react";
import { mfaRequiredButMissing, paperWhere } from "@/server/auth/access";
import { db } from "@/server/db";
import { demoModeEnabled } from "@/server/env";
import { RichContent } from "@/components/app/rich-content";
import { ConsentButtons } from "@/features/compliance/controls";
import { pendingRequiredNotices } from "@/server/services/privacy";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageAuth();
  const uid = ctx.user.id;

  const [notifications, unread, inbox, moderation, scrutiny, approvals, assignments] = await Promise.all([
    db.notification.findMany({ where: { userId: uid }, orderBy: { createdAt: "desc" }, take: 8 }),
    db.notification.count({ where: { userId: uid, readAt: null } }),
    db.workflowTask.count({ where: { assigneeId: uid, status: "PENDING", instance: { status: "IN_PROGRESS" } } }),
    can(ctx, "moderation.perform")
      ? db.questionPaper.count({ where: { deletedAt: null, examination: { moderatorId: uid }, status: { in: ["SUBMITTED", "RESUBMITTED", "UNDER_MODERATION"] } } })
      : 0,
    can(ctx, "scrutiny.perform") ? db.questionPaper.count({ where: { deletedAt: null, examination: { scrutinizerId: uid }, status: "UNDER_SCRUTINY" } }) : 0,
    can(ctx, "paper.approve") ? db.questionPaper.count({ where: { AND: [paperWhere(ctx), { status: "AWAITING_APPROVAL" }] } }) : 0,
    can(ctx, "assignment.respond") ? db.setterAssignment.count({ where: { setterId: uid, status: { in: ["ASSIGNED", "RETURNED"] } } }) : 0,
  ]);
  const counts = { inbox, moderation, scrutiny, approvals, assignments };
  const needsMfa = await mfaRequiredButMissing(ctx);
  // DPDP: required privacy notices must be acknowledged before anything else.
  const pendingNotices = await pendingRequiredNotices(ctx);

  const t = (x: string) => translate(ctx.user.locale, x);
  const nav: NavGroup[] = NAV.map((g) => ({
    ...g,
    label: t(g.label),
    items: g.items
      .filter((i) => (!i.audience || (i.audience === "staff") === (ctx.user.userType === "STAFF")) && (!i.any || canAny(ctx, i.any)) && (!i.employee || !!ctx.subject.employeeId) && (!i.superAdmin || isSuperAdmin(ctx)))
      .map((i) => ({ ...i, label: t(i.label), count: i.badgeKey ? counts[i.badgeKey] : undefined })),
  })).filter((g) => g.items.length > 0);

  const commands: PaletteCommand[] = [];
  if (can(ctx, "question.create")) commands.push({ group: "Create", label: "Create question", href: "/question-bank/new" });
  if (can(ctx, "session.manage")) commands.push({ group: "Create", label: "Create examination session", href: "/examinations/sessions?new=1" });
  if (can(ctx, "assignment.manage")) commands.push({ group: "Create", label: "Appoint a paper setter", href: "/setters?assign=1" });
  if (can(ctx, "blueprint.manage")) commands.push({ group: "Create", label: "Create blueprint", href: "/blueprints/new" });
  if (can(ctx, "paper.edit.own")) commands.push({ group: "Create", label: "Create / open my paper", href: "/assignments" });
  for (const g of nav) for (const i of g.items) commands.push({ group: "Go to", label: i.label, href: i.href });
  commands.push({ group: "Go to", label: "Profile & security", href: "/profile" });
  if (ctx.user.userType === "STAFF") commands.push({ group: "Create", label: "Request access to a role", href: "/inbox/new/access" });
  commands.push({ group: "Go to", label: "Out of office (delegate approvals)", href: "/inbox/delegations" });

  return (
    <I18nProvider dict={dictionary(ctx.user.locale)}>
    <AppShell
      user={{
        name: ctx.user.name,
        email: ctx.user.email,
        designation: ctx.user.designation,
        roleName: ctx.primaryRole.name + (ctx.roles.length > 1 ? ` +${ctx.roles.length - 1}` : ""),
        departmentName: ctx.user.departmentName,
      }}
      nav={nav}
      notifications={notifications.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, createdAt: n.createdAt.toISOString(), read: !!n.readAt }))}
      unread={unread}
      commands={commands}
      demoMode={demoModeEnabled}
      locale={ctx.user.locale}
      initialCollapsed={(await cookies()).get("ec_sidebar")?.value === "collapsed"}
    >
      {needsMfa && (
        <div role="alert" className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-tone-warning/40 bg-tone-warning/5 px-4 py-3 text-sm">
          <ShieldAlert className="size-5 text-tone-warning" />
          <span className="flex-1">Your role requires two-step verification. Confidential papers stay locked until you enrol.</span>
          <Link href="/profile#security" className="font-semibold text-primary hover:underline">Set up now</Link>
        </div>
      )}
      {pendingNotices.length ? (
        <section aria-labelledby="consent-title" className="mx-auto max-w-3xl space-y-4">
          <h1 id="consent-title" className="text-2xl font-semibold">Before you continue</h1>
          <p className="text-sm text-muted-foreground">Please read how the institution uses your personal data. You can see these notices again, and make or change optional choices, under Privacy &amp; consent.</p>
          {pendingNotices.map((n) => (
            <article key={n.id} className="surface-card space-y-3 p-5">
              <h2 className="font-semibold">{n.title} <span className="text-xs font-normal text-muted-foreground">v{n.version}</span></h2>
              <p className="text-sm text-muted-foreground">{n.purpose}</p>
              <div className="max-h-72 overflow-y-auto rounded-lg bg-muted/40 p-3 text-sm"><RichContent body={n.body} /></div>
              <ConsentButtons noticeId={n.id} decision={null} required />
            </article>
          ))}
        </section>
      ) : (
        children
      )}
    </AppShell>
    </I18nProvider>
  );
}
