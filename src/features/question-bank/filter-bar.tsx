"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Bookmark, BookmarkPlus, Loader2, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { deleteFilterAction, saveFilterAction } from "@/features/question-bank/actions";
import { BLOOM_K, BLOOM_LABEL, DIFFICULTY_LABEL, QUESTION_STATUS_LABEL, QUESTION_TYPE_LABEL } from "@/lib/domain/labels";

const sel = "h-8 rounded-lg border bg-card px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30";

export function QuestionFilterBar({
  courses,
  units,
  tags,
  saved,
}: {
  courses: { id: string; code: string; title: string }[];
  units: number[];
  tags: string[];
  saved: { id: string; name: string; query: Record<string, string> }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [pending, start] = useTransition();

  const push = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    if (!("page" in patch)) p.delete("page");
    start(() => router.replace(`${pathname}?${p.toString()}`, { scroll: false }));
  };

  useEffect(() => {
    const current = sp.get("q") ?? "";
    if (q === current) return;
    const t = setTimeout(() => push({ q: q || null, sort: q ? "relevance" : sp.get("sort") }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const v = (k: string) => sp.get(k) ?? "";
  const activeFilters = ["courseId", "unit", "marks", "difficulty", "bloom", "type", "status", "tag", "usage"].filter((k) => sp.get(k));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <Search aria-hidden className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search question text, keywords or code (Q-000123)…" aria-label="Search the question bank" className="h-10 rounded-xl pl-9 text-[14px]" />
          {pending && <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-10"><Bookmark /> Saved filters</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-xs">Saved filters</DropdownMenuLabel>
            {saved.length === 0 && <div className="px-2 py-2 text-xs text-muted-foreground">None yet.</div>}
            {saved.map((f) => (
              <DropdownMenuItem key={f.id} className="justify-between" onSelect={() => start(() => router.replace(`${pathname}?${new URLSearchParams(f.query).toString()}`))}>
                <span className="truncate">{f.name}</span>
                <button
                  type="button"
                  aria-label={`Delete ${f.name}`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    start(async () => {
                      await deleteFilterAction(f.id);
                      router.refresh();
                    });
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!sp.toString()}
              onSelect={() => {
                const name = prompt("Name this filter");
                if (!name) return;
                const query = Object.fromEntries([...sp.entries()].filter(([k]) => k !== "page"));
                start(async () => {
                  const res = await saveFilterAction({ name, query });
                  if (res.ok) {
                    toast.success("Filter saved");
                    router.refresh();
                  } else toast.error(res.error);
                });
              }}
            >
              <BookmarkPlus /> Save current filters
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        <select aria-label="Course" className={sel} value={v("courseId")} onChange={(e) => push({ courseId: e.target.value || null, unit: null })}>
          <option value="">All courses</option>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}
        </select>
        <select aria-label="Unit" className={sel} value={v("unit")} onChange={(e) => push({ unit: e.target.value || null })}>
          <option value="">Any unit</option>
          {units.map((u) => <option key={u} value={u}>Unit {u}</option>)}
        </select>
        <select aria-label="Marks" className={sel} value={v("marks")} onChange={(e) => push({ marks: e.target.value || null })}>
          <option value="">Any marks</option>
          {[1, 2, 3, 5, 6, 8, 10, 12, 15, 18, 20].map((m) => <option key={m} value={m}>{m} marks</option>)}
        </select>
        <select aria-label="Difficulty" className={sel} value={v("difficulty")} onChange={(e) => push({ difficulty: e.target.value || null })}>
          <option value="">Any difficulty</option>
          {Object.entries(DIFFICULTY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select aria-label="Bloom level" className={sel} value={v("bloom")} onChange={(e) => push({ bloom: e.target.value || null })}>
          <option value="">Any Bloom level</option>
          {Object.entries(BLOOM_LABEL).map(([k, l]) => <option key={k} value={k}>{BLOOM_K[k as keyof typeof BLOOM_K]} · {l}</option>)}
        </select>
        <select aria-label="Question type" className={sel} value={v("type")} onChange={(e) => push({ type: e.target.value || null })}>
          <option value="">Any type</option>
          {Object.entries(QUESTION_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select aria-label="Tag" className={sel} value={v("tag")} onChange={(e) => push({ tag: e.target.value || null })}>
          <option value="">Any tag</option>
          {tags.map((t) => <option key={t} value={t}>#{t}</option>)}
        </select>
        <select aria-label="Usage" className={sel} value={v("usage")} onChange={(e) => push({ usage: e.target.value || null })}>
          <option value="">Any usage</option>
          <option value="never">Never used</option>
          <option value="used">Used before</option>
          <option value="frequent">Used 2+ times</option>
        </select>
        <select aria-label="Status" className={sel} value={v("status")} onChange={(e) => push({ status: e.target.value || null })}>
          <option value="">Active & pending</option>
          {Object.entries(QUESTION_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select aria-label="Sort by" className={sel} value={v("sort")} onChange={(e) => push({ sort: e.target.value || null })}>
          <option value="">Newest first</option>
          <option value="relevance">Relevance</option>
          <option value="oldest">Oldest first</option>
          <option value="most-used">Most used</option>
          <option value="least-used">Least used</option>
          <option value="marks">Marks</option>
        </select>
        {activeFilters.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => { setQ(""); start(() => router.replace(pathname)); }}>
            <X /> Clear {activeFilters.length}
          </Button>
        )}
      </div>
    </div>
  );
}
