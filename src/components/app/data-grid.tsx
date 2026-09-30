"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Bookmark, ChevronLeft, ChevronRight, Columns3, Download, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { deleteViewAction, saveViewAction } from "@/features/shell/views";
import { cn } from "@/lib/utils";

export interface GridColumn {
  key: string;
  label: string;
  /** URL sort value; "-" prefix is added for descending */
  sort?: string;
  className?: string;
  hidden?: boolean;
  /** cannot be hidden */
  pinned?: boolean;
  width?: number;
}

export interface GridRow {
  id: string;
  cells: Record<string, React.ReactNode>;
}

export interface BulkAction {
  label: string;
  /** Server action receiving the selected ids; returns an ActionResult-like object */
  run: (ids: string[]) => Promise<{ ok: boolean; error?: string; message?: string }>;
  confirm?: string;
  destructive?: boolean;
}

interface SavedView {
  id: string;
  name: string;
  query: Record<string, string>;
}

function readPrefs(key: string): { hidden?: string[]; widths?: Record<string, number> } {
  try {
    return JSON.parse(localStorage.getItem(`grid:${key}`) ?? "{}");
  } catch {
    return {};
  }
}

function writePrefs(key: string, prefs: { hidden: string[]; widths: Record<string, number> }) {
  try {
    localStorage.setItem(`grid:${key}`, JSON.stringify(prefs));
  } catch {
    /* storage unavailable: preferences are per session only */
  }
}

/**
 * Enterprise data grid. Data is paged, sorted and filtered on the server (URL state, shareable);
 * the grid adds column choice and widths (remembered per browser), row selection, bulk actions,
 * saved views and an export link for the full filtered set.
 */
export function DataGrid({
  gridKey,
  columns,
  rows,
  total,
  page,
  pageSize,
  bulkActions = [],
  exportHref,
  savedViews,
  empty,
  selectable = bulkActions.length > 0,
}: {
  gridKey: string;
  columns: GridColumn[];
  rows: GridRow[];
  total: number;
  page: number;
  pageSize: number;
  bulkActions?: BulkAction[];
  exportHref?: string;
  savedViews?: SavedView[];
  empty?: React.ReactNode;
  selectable?: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [hidden, setHidden] = useState<string[]>(() => columns.filter((c) => c.hidden).map((c) => c.key));
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const loaded = useRef(false);

  useEffect(() => {
    const p = readPrefs(gridKey);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate per-browser preferences after mount (localStorage is client-only)
    if (p.hidden) setHidden(p.hidden);
    if (p.widths) setWidths(p.widths);
    loaded.current = true;
  }, [gridKey]);
  useEffect(() => {
    if (loaded.current) writePrefs(gridKey, { hidden, widths });
  }, [gridKey, hidden, widths]);
  // Selection is per page; clear it when the data changes.
  const rowKey = rows.map((r) => r.id).join(",");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset selection when the page of data changes
    setSelected(new Set());
  }, [rowKey]);

  const visible = columns.filter((c) => c.pinned || !hidden.includes(c.key));
  const sort = params.get("sort") ?? "";
  const href = useCallback((patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) if (v === null || v === "") p.delete(k); else p.set(k, v);
    const s = p.toString();
    return s ? `${path}?${s}` : path;
  }, [params, path]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const currentQuery = useMemo(() => Object.fromEntries([...params.entries()].filter(([k]) => k !== "page")), [params]);

  const startResize = (key: string, e: React.PointerEvent) => {
    e.preventDefault();
    const th = (e.target as HTMLElement).closest("th")!;
    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;
    const move = (ev: PointerEvent) => setWidths((w) => ({ ...w, [key]: Math.max(60, Math.round(startW + ev.clientX - startX)) }));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="surface-card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        {selected.size > 0 ? (
          <>
            <span className="text-sm font-medium">{selected.size} selected</span>
            <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}><X /> Clear</Button>
            {bulkActions.map((a) => (
              <Button
                key={a.label}
                size="xs"
                variant={a.destructive ? "destructive" : "outline"}
                disabled={pending}
                onClick={() => {
                  if (a.confirm && !confirm(a.confirm.replace("{n}", String(selected.size)))) return;
                  start(async () => {
                    const r = await a.run([...selected]);
                    if (!r.ok) toast.error(r.error ?? "Failed");
                    else {
                      toast.success(r.message ?? "Done");
                      setSelected(new Set());
                      router.refresh();
                    }
                  });
                }}
              >
                {pending && <Loader2 className="animate-spin" />} {a.label}
              </Button>
            ))}
          </>
        ) : (
          <span className="text-xs text-muted-foreground tabular">{total.toLocaleString()} record{total === 1 ? "" : "s"}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {savedViews && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="xs" variant="ghost"><Bookmark /> Views</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Saved views</DropdownMenuLabel>
                {savedViews.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No saved views yet.</div>}
                {savedViews.map((v) => (
                  <div key={v.id} className="flex items-center">
                    <DropdownMenuItem asChild className="flex-1"><Link href={`${path}?${new URLSearchParams(v.query).toString()}`}>{v.name}</Link></DropdownMenuItem>
                    <button type="button" aria-label={`Delete view ${v.name}`} className="grid size-7 place-items-center rounded hover:bg-muted" onClick={() => start(async () => { await deleteViewAction(v.id, path); router.refresh(); })}><Trash2 className="size-3.5" /></button>
                  </div>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    const name = prompt("Name this view (current filters and sort)");
                    if (!name) return;
                    start(async () => {
                      const r = await saveViewAction({ scope: gridKey, name, query: currentQuery, path });
                      if (!r.ok) toast.error(r.error);
                      else router.refresh();
                    });
                  }}
                >
                  Save current view…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="xs" variant="ghost"><Columns3 /> Columns</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {columns.filter((c) => !c.pinned).map((c) => (
                <DropdownMenuCheckboxItem key={c.key} checked={!hidden.includes(c.key)} onSelect={(e) => e.preventDefault()} onCheckedChange={(on) => setHidden((h) => (on ? h.filter((x) => x !== c.key) : [...h, c.key]))}>
                  {c.label}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => { setHidden(columns.filter((c) => c.hidden).map((c) => c.key)); setWidths({}); }}>Reset columns</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {exportHref && <Button asChild size="xs" variant="ghost"><a href={exportHref}><Download /> Export CSV</a></Button>}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="p-6">{empty ?? <p className="text-center text-sm text-muted-foreground">No records match.</p>}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-rowcount={total}>
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                {selectable && (
                  <th scope="col" className="w-10 pl-4">
                    <input type="checkbox" aria-label="Select all on this page" className="size-4 accent-[var(--primary)]" checked={allOnPage} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />
                  </th>
                )}
                {visible.map((c) => {
                  const active = sort === c.sort ? "asc" : sort === `-${c.sort}` ? "desc" : null;
                  return (
                    <th key={c.key} scope="col" aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : undefined} style={widths[c.key] ? { width: widths[c.key], minWidth: widths[c.key] } : undefined} className={cn("group relative px-4 py-2.5 font-medium whitespace-nowrap first:pl-5 last:pr-5", c.className)}>
                      {c.sort ? (
                        <Link href={href({ sort: active === "asc" ? `-${c.sort}` : c.sort, page: null })} className="inline-flex items-center gap-1 hover:text-foreground">
                          {c.label}
                          {active === "asc" ? <ArrowUp className="size-3" /> : active === "desc" ? <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-0 group-hover:opacity-50" />}
                        </Link>
                      ) : (
                        c.label
                      )}
                      <span role="separator" aria-orientation="vertical" aria-label={`Resize ${c.label}`} onPointerDown={(e) => startResize(c.key, e)} className="absolute inset-y-1 right-0 w-1.5 cursor-col-resize rounded hover:bg-primary/30" />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} className={cn("hover:bg-muted/40", selected.has(r.id) && "bg-primary/5")}>
                  {selectable && (
                    <td className="pl-4">
                      <input type="checkbox" aria-label="Select row" className="size-4 accent-[var(--primary)]" checked={selected.has(r.id)} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} />
                    </td>
                  )}
                  {visible.map((c) => (
                    <td key={c.key} className={cn("px-4 py-2.5 align-middle first:pl-5 last:pr-5", c.className)} style={widths[c.key] ? { maxWidth: widths[c.key] } : undefined}>{r.cells[c.key]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > 0 && (
        <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t px-5 py-3 text-xs text-muted-foreground">
          <span>{(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total.toLocaleString()}</span>
          <div className="flex items-center gap-1">
            {page > 1 ? <Link aria-label="Previous page" href={href({ page: String(page - 1) })} className="grid size-7 place-items-center rounded-md hover:bg-muted"><ChevronLeft className="size-4" /></Link> : <span className="grid size-7 place-items-center opacity-40"><ChevronLeft className="size-4" /></span>}
            <span className="px-2 tabular">Page {page} of {pages}</span>
            {page < pages ? <Link aria-label="Next page" href={href({ page: String(page + 1) })} className="grid size-7 place-items-center rounded-md hover:bg-muted"><ChevronRight className="size-4" /></Link> : <span className="grid size-7 place-items-center opacity-40"><ChevronRight className="size-4" /></span>}
          </div>
        </nav>
      )}
    </div>
  );
}
