"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { motion } from "motion/react";
import {
  Bell, CheckCheck, ChevronsLeft, ChevronsRight, KeyRound, LogOut, Menu, Moon, Search, Sun, UserRound,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CommandPalette, type PaletteCommand } from "@/components/shell/command-palette";
import { useT } from "@/components/i18n";
import { LanguageSwitcher } from "@/components/language-switcher";
import type { Locale } from "@/lib/i18n";
import { NavIcon } from "@/components/shell/icons";
import type { NavGroup } from "@/components/shell/nav";
import { logoutAction, markAllNotificationsRead, markNotificationRead } from "@/features/shell/actions";
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";

export interface ShellUser {
  name: string;
  email: string;
  designation: string | null;
  roleName: string;
  departmentName: string | null;
}

export interface ShellNotification {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  read: boolean;
}

export function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative grid size-8 shrink-0 place-items-center rounded-[9px] bg-gradient-to-b from-[oklch(0.5_0.17_262)] to-[oklch(0.38_0.16_266)] text-white shadow-[inset_0_1px_0_oklch(1_0_0/0.25)]">
        <svg viewBox="0 0 24 24" className="size-4.5" aria-hidden>
          <path d="M6 5h12M6 12h9M6 19h12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="18.5" cy="12" r="1.6" fill="currentColor" />
        </svg>
      </div>
      {!collapsed && (
        <div className="leading-none">
          <div className="text-[15px] font-semibold tracking-[0.06em]">{BRAND.name}</div>
          <div className="mt-1 text-[10.5px] text-muted-foreground">{BRAND.tagline}</div>
        </div>
      )}
    </div>
  );
}

function initials(name: string) {
  return name
    .replace(/^(Dr\.|Prof\.|Mr\.|Ms\.|Mrs\.)\s*/i, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

function SidebarNav({ nav, collapsed, onNavigate }: { nav: NavGroup[]; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname === href || (pathname.startsWith(href + "/") && !nav.some((g) => g.items.some((i) => i.href !== href && i.href.startsWith(href + "/") && pathname.startsWith(i.href))));
  return (
    <nav aria-label="Main" className="flex flex-col gap-5 px-3 pb-6">
      {nav.map((g) => (
        <div key={g.label}>
          {!collapsed && <div className="eyebrow mb-1.5 px-2.5">{g.label}</div>}
          <ul className="flex flex-col gap-0.5">
            {g.items.map((item) => {
              const active = isActive(item.href);
              const badge = (item as { count?: number }).count;
              const link = (
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    active && "bg-sidebar-accent text-sidebar-accent-foreground",
                    collapsed && "justify-center px-0",
                  )}
                >
                  {active && <motion.span layoutId="nav-active" className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-primary" />}
                  <NavIcon name={item.icon} className={cn("size-4 shrink-0 opacity-70", active && "text-primary opacity-100")} />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                  {!!badge && (
                    <span
                      className={cn(
                        "ml-auto min-w-5 rounded-full bg-primary px-1.5 text-center text-[10.5px] leading-5 font-semibold text-primary-foreground tabular",
                        collapsed && "absolute -top-1 -right-1 ml-0 min-w-4 px-1 text-[9.5px] leading-4",
                      )}
                    >
                      {badge}
                      <span className="sr-only"> pending</span>
                    </span>
                  )}
                </Link>
              );
              return (
                <li key={item.href}>
                  {collapsed ? (
                    <Tooltip>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent side="right">{item.label}</TooltipContent>
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function NotificationBell({ unread, items }: { unread: number; items: ShellNotification[] }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
          <Bell className="size-4.5" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-tone-danger px-1 text-[9.5px] leading-4 font-semibold text-white tabular">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-sm font-semibold">{t("Notifications")}</div>
          <Button
            variant="ghost"
            size="xs"
            disabled={!unread}
            onClick={() => start(async () => {
              await markAllNotificationsRead();
              router.refresh();
            })}
          >
            <CheckCheck /> Mark all read
          </Button>
        </div>
        <ul className="max-h-[420px] overflow-y-auto py-1">
          {items.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted-foreground">{t("You're all caught up.")}</li>}
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className="flex w-full gap-3 px-4 py-2.5 text-left hover:bg-muted/60"
                onClick={() => {
                  setOpen(false);
                  start(async () => {
                    if (!n.read) await markNotificationRead(n.id);
                    if (n.link) router.push(n.link);
                    router.refresh();
                  });
                }}
              >
                <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-primary")} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-[13px]", !n.read && "font-semibold")}>
                    {!n.read && <span className="sr-only">Unread: </span>}
                    {n.title}
                  </span>
                  {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{n.body}</span>}
                  <span className="mt-1 block text-[11px] text-muted-foreground">{formatDistanceToNowStrict(new Date(n.createdAt), { addSuffix: true })}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t p-2">
          <Button asChild variant="ghost" size="sm" className="w-full" onClick={() => setOpen(false)}>
            <Link href="/notifications">{t("View all notifications")}</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function AppShell({
  user,
  nav,
  notifications,
  unread,
  commands,
  demoMode,
  initialCollapsed,
  locale = "en",
  children,
}: {
  user: ShellUser;
  nav: NavGroup[];
  notifications: ShellNotification[];
  unread: number;
  commands: PaletteCommand[];
  demoMode: boolean;
  initialCollapsed?: boolean;
  locale?: Locale;
  children: React.ReactNode;
}) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(!!initialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      document.cookie = `ec_sidebar=${c ? "expanded" : "collapsed"}; path=/; max-age=31536000; samesite=lax`;
      return !c;
    });
  };

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 68 : 252 }}
        transition={{ type: "spring", stiffness: 380, damping: 36 }}
        className="sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-sidebar lg:flex"
      >
        <div className={cn("flex h-14 items-center px-4", collapsed && "justify-center px-0")}>
          <Link href="/dashboard" aria-label={`${BRAND.name} dashboard`}>
            <Logo collapsed={collapsed} />
          </Link>
        </div>
        <div className="flex-1 overflow-x-hidden overflow-y-auto pt-2">
          <SidebarNav nav={nav} collapsed={collapsed} />
        </div>
        <div className={cn("border-t p-3", collapsed && "flex justify-center")}>
          <Button variant="ghost" size={collapsed ? "icon" : "sm"} onClick={toggle} className={cn(!collapsed && "w-full justify-start text-muted-foreground")} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <ChevronsRight /> : <><ChevronsLeft /> {t("Collapse")}</>}
          </Button>
        </div>
      </motion.aside>

      {/* Mobile sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[280px] bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex h-14 items-center px-4">
            <Logo />
          </div>
          <div className="overflow-y-auto">
            <SidebarNav nav={nav} collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-3 sm:px-5">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 w-full min-w-0 max-w-md items-center gap-2 rounded-lg border bg-card/70 px-3 text-left text-sm text-muted-foreground shadow-[var(--shadow-soft)] transition-colors hover:border-primary/30"
          >
            <Search className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{t("Search papers, questions, courses…")}</span>
            <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[10.5px] sm:inline">Ctrl K</kbd>
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {demoMode && (
              <span className="mr-2 hidden whitespace-nowrap rounded-full bg-tone-warning/10 px-2.5 py-1 text-[11px] font-semibold text-tone-warning ring-1 ring-tone-warning/25 md:inline">
                {t("Demo environment")}
              </span>
            )}
            <LanguageSwitcher current={locale} label={t("Language")} className="mr-1" />
            <Button variant="ghost" size="icon" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} aria-label="Toggle colour theme">
              <Sun className="hidden size-4.5 dark:block" aria-hidden />
              <Moon className="size-4.5 dark:hidden" aria-hidden />
            </Button>
            <NotificationBell unread={unread} items={notifications} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="ml-1 flex items-center gap-2.5 rounded-lg py-1 pr-2 pl-1 hover:bg-muted" aria-label="Account menu">
                  <span className="grid size-8 place-items-center rounded-full bg-primary/10 text-[12px] font-semibold text-primary">{initials(user.name)}</span>
                  <span className="hidden text-left leading-tight md:block">
                    <span className="block max-w-[180px] truncate text-[13px] font-medium">{user.name}</span>
                    <span className="block max-w-[180px] truncate text-[11px] text-muted-foreground">{user.roleName}</span>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="font-normal">
                  <div className="text-sm font-medium">{user.name}</div>
                  <div className="text-xs text-muted-foreground">{user.email}</div>
                  {user.departmentName && <div className="mt-0.5 text-xs text-muted-foreground">{user.departmentName}</div>}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/profile"><UserRound /> {t("Profile")}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/profile#security"><KeyRound /> {t("Security & sessions")}</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => void logoutAction()}>
                  <LogOut /> {t("Sign out")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1480px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} commands={commands} />
    </div>
  );
}
