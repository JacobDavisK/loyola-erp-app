import { AppShell } from "@/components/shell/app-shell";
import type { PaletteCommand } from "@/components/shell/command-palette";
import { NAV, type NavGroup } from "@/components/shell/nav";
import { can, canAny, requirePageAuth, isSuperAdmin } from "@/server/auth/current";
import Link from "next/link";
import { cookies } from "next/headers";
import { ShieldAlert } from "lucide-react";
import { mfaRequiredButMissing, paperWhere } from "@/server/auth/access";
import { db } from "@/server/db";
import { demoModeEnabled } from "@/server/env";

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

  const nav: NavGroup[] = NAV.map((g) => ({
    ...g,
    items: g.items
      .filter((i) => (!i.audience || (i.audience === "staff") === (ctx.user.userType === "STAFF")) && (!i.any || canAny(ctx, i.any)) && (!i.employee || !!ctx.subject.employeeId) && (!i.superAdmin || isSuperAdmin(ctx)))
      .map((i) => ({ ...i, count: i.badgeKey ? counts[i.badgeKey] : undefined })),
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
      initialCollapsed={(await cookies()).get("ec_sidebar")?.value === "collapsed"}
    >
      {needsMfa && (
        <div role="alert" className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-tone-warning/40 bg-tone-warning/5 px-4 py-3 text-sm">
          <ShieldAlert className="size-5 text-tone-warning" />
          <span className="flex-1">Your role requires two-step verification. Confidential papers stay locked until you enrol.</span>
          <Link href="/profile#security" className="font-semibold text-primary hover:underline">Set up now</Link>
        </div>
      )}
      {children}
    </AppShell>
  );
}
