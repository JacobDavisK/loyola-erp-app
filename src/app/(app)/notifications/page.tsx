import Link from "next/link";
import { Bell } from "lucide-react";
import type { Metadata } from "next";
import { LinkTabs, Pagination, qs } from "@/components/app/list";
import { EmptyState, PageHeader } from "@/components/app/page";
import { MarkAllRead } from "@/features/notifications/mark-all-read";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ filter?: string; page?: string }> }) {
  const ctx = await requirePageAuth();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = 30;
  const unreadOnly = sp.filter === "unread";
  const where = { userId: ctx.user.id, ...(unreadOnly ? { readAt: null } : {}) };
  const [rows, total, unread] = await Promise.all([
    db.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    db.notification.count({ where }),
    db.notification.count({ where: { userId: ctx.user.id, readAt: null } }),
  ]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Notifications" description="Assignments, submissions, review outcomes, deadlines and approvals that concern you." actions={<MarkAllRead disabled={!unread} />} />
      <LinkTabs className="mb-4" active={unreadOnly ? "unread" : "all"} tabs={[{ key: "all", label: "All", href: "/notifications" }, { key: "unread", label: "Unread", count: unread, href: "/notifications?filter=unread" }]} />
      {rows.length === 0 ? (
        <EmptyState icon={Bell} title={unreadOnly ? "You're all caught up" : "No notifications yet"} description="New assignments, review outcomes and deadline reminders will appear here." />
      ) : (
        <ul className="surface-card divide-y">
          {rows.map((n) => (
            <li key={n.id}>
              <Link href={n.link ?? "/dashboard"} className="flex gap-3 px-5 py-4 hover:bg-muted/40">
                <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent ring-1 ring-border" : "bg-primary")} />
                <div className="min-w-0 flex-1">
                  <div className={cn("text-sm", !n.readAt && "font-semibold")}>{!n.readAt && <span className="sr-only">Unread: </span>}{n.title}</div>
                  {n.body && <div className="mt-0.5 text-sm text-muted-foreground">{n.body}</div>}
                </div>
                <time className="shrink-0 text-xs text-muted-foreground" dateTime={n.createdAt.toISOString()} title={fmtDateTime(n.createdAt)}>{fmtRelative(n.createdAt)}</time>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2"><Pagination page={page} pageSize={pageSize} total={total} hrefFor={(p) => `/notifications${qs({ filter: sp.filter }, { page: p })}`} /></div>
    </div>
  );
}
