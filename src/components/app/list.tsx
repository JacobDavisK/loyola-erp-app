import Link from "next/link";
import { Children } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/** Link-driven tabs (URL is the state, so views are shareable and work without JS). */
export function LinkTabs({ tabs, active, className }: { tabs: { key: string; label: string; href: string; count?: number }[]; active: string; className?: string }) {
  return (
    <nav aria-label="Views" className={cn("-mx-1 flex gap-1 overflow-x-auto px-1 pb-1", className)}>
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={cn(
            "flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            t.key === active && "bg-card text-foreground shadow-[var(--shadow-soft)] ring-1 ring-border",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="rounded-full bg-muted px-1.5 text-[11px] tabular">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function SearchForm({ defaultValue, placeholder, hidden }: { defaultValue?: string; placeholder: string; hidden?: Record<string, string | undefined> }) {
  return (
    <form role="search" className="relative w-full max-w-xs">
      {Object.entries(hidden ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <Search aria-hidden className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-8 w-full rounded-lg border bg-card pr-3 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
      />
    </form>
  );
}

export function Pagination({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (p: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t px-5 py-3 text-xs text-muted-foreground">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <PageLink href={page > 1 ? hrefFor(page - 1) : null} label="Previous page"><ChevronLeft className="size-4" /></PageLink>
        <span className="px-2 tabular">
          Page {page} of {pages}
        </span>
        <PageLink href={page < pages ? hrefFor(page + 1) : null} label="Next page"><ChevronRight className="size-4" /></PageLink>
      </div>
    </nav>
  );
}

function PageLink({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  if (!href) return <span aria-disabled className="grid size-7 place-items-center rounded-md opacity-40">{children}</span>;
  return (
    <Link href={href} aria-label={label} className="grid size-7 place-items-center rounded-md hover:bg-muted hover:text-foreground">
      {children}
    </Link>
  );
}

export function qs(base: Record<string, string | number | undefined | null>, patch: Record<string, string | number | undefined | null>) {
  const merged = { ...base, ...patch };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Consistent data table styling (semantic <table>, sticky header, keyboard-focusable row links). */
export function DataTable({ head, children, empty }: { head: { label: string; className?: string }[]; children: React.ReactNode; empty?: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            {head.map((h, i) => (
              <th key={i} scope="col" className={cn("px-4 py-2.5 font-medium whitespace-nowrap first:pl-5 last:pr-5", h.className)}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
      {/* The empty state shows only when there are no rows; a plain string gets standard styling. */}
      {Children.toArray(children).length === 0 && empty ? (typeof empty === "string" ? <p className="px-5 py-8 text-center text-sm text-muted-foreground">{empty}</p> : empty) : null}
    </div>
  );
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("px-4 py-3 align-middle first:pl-5 last:pr-5", className)}>{children}</td>;
}
