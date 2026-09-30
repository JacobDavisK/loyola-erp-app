"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, GripVertical, History, Loader2, Plus, Search } from "lucide-react";
import { RichContent } from "@/components/app/rich-content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { searchBankAction } from "@/features/papers/actions";
import { BLOOM_K, BLOOM_LABEL, DIFFICULTY_LABEL } from "@/lib/domain/labels";
import type { PaperItemData } from "@/lib/domain/paper-types";
import { cn } from "@/lib/utils";
import type { QuestionListRow } from "@/server/services/questions";
import { QuestionMeta, toItem } from "./question-meta";

export { QuestionMeta, toItem } from "./question-meta";
import type { BuilderUnit } from "./types";

const selectCls = "h-7 rounded-md border bg-card px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export function BankPanel({
  courseId,
  units,
  usedIds,
  sections,
  onAdd,
  searchRef,
  presetMarks,
}: {
  courseId: string;
  units: BuilderUnit[];
  usedIds: string[];
  sections: { key: string; label: string; marksPerQuestion: number | null }[];
  onAdd: (item: PaperItemData, sectionKey?: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  presetMarks?: number | null;
}) {
  const [q, setQ] = useState("");
  const [unit, setUnit] = useState("");
  const [marks, setMarks] = useState(presetMarks ? String(presetMarks) : "");
  const [difficulty, setDifficulty] = useState("");
  const [bloom, setBloom] = useState("");
  const [rows, setRows] = useState<QuestionListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const seq = useRef(0);

  const [prevPreset, setPrevPreset] = useState(presetMarks);
  if (presetMarks !== prevPreset) {
    setPrevPreset(presetMarks);
    if (presetMarks) setMarks(String(presetMarks));
  }

  const load = useCallback(
    async (p: number) => {
      const id = ++seq.current;
      setLoading(true);
      const res = await searchBankAction({
        q: q || undefined,
        courseId,
        unit: unit || undefined,
        marks: marks || undefined,
        difficulty: difficulty || undefined,
        bloom: bloom || undefined,
        status: "ACTIVE",
        page: p,
        pageSize: 20,
        sort: q ? "relevance" : "marks",
      });
      if (id !== seq.current) return;
      setLoading(false);
      if (!res.ok) return;
      setTotal(res.data.total);
      setPage(p);
      setRows((prev) => (p === 1 ? res.data.rows : [...prev, ...res.data.rows]));
    },
    [q, courseId, unit, marks, difficulty, bloom],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(1), q ? 200 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const used = new Set(usedIds);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b p-3">
        <div className="relative">
          <Search aria-hidden className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search bank  ( / )" aria-label="Search question bank" className="h-8 pl-8 text-[13px]" />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <select aria-label="Unit" className={selectCls} value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="">All units</option>
            {units.map((u) => (
              <option key={u.number} value={u.number}>Unit {u.number}</option>
            ))}
          </select>
          <select aria-label="Marks" className={selectCls} value={marks} onChange={(e) => setMarks(e.target.value)}>
            <option value="">Any marks</option>
            {[1, 2, 3, 5, 6, 8, 10, 12, 15, 18, 20].map((m) => (
              <option key={m} value={m}>{m} marks</option>
            ))}
          </select>
          <select aria-label="Difficulty" className={selectCls} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            <option value="">Any difficulty</option>
            {Object.entries(DIFFICULTY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select aria-label="Bloom level" className={selectCls} value={bloom} onChange={(e) => setBloom(e.target.value)}>
            <option value="">Any Bloom level</option>
            {Object.entries(BLOOM_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{BLOOM_K[k as keyof typeof BLOOM_K]} {v}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground" aria-live="polite">
          <span>{loading ? "Searching…" : `${total} question${total === 1 ? "" : "s"}`}</span>
          {loading && <Loader2 className="size-3 animate-spin" />}
        </div>
      </div>
      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {!loading && rows.length === 0 && <li className="px-2 py-10 text-center text-xs text-muted-foreground">No questions match these filters.</li>}
        {rows.map((r) => {
          const inPaper = used.has(r.id);
          const item = toItem(r);
          const open = expanded === r.id;
          const matching = sections.filter((s) => !s.marksPerQuestion || s.marksPerQuestion === r.marks);
          return (
            <li
              key={r.id}
              draggable={!inPaper}
              onDragStart={(e) => {
                e.dataTransfer.setData("application/x-examcore-question", JSON.stringify(item));
                e.dataTransfer.effectAllowed = "copy";
              }}
              className={cn("group rounded-lg border bg-card p-2.5 transition-shadow", inPaper ? "opacity-55" : "cursor-grab hover:shadow-[var(--shadow-soft)] active:cursor-grabbing")}
            >
              <div className="flex items-start gap-1.5">
                <GripVertical aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground">{r.code}</span>
                    {r.usageCount > 0 && (
                      <span className="flex items-center gap-1 text-[10.5px] text-tone-warning" title={`Used ${r.usageCount}× — last in ${r.lastUsedSessionId ?? ""}`}>
                        <History className="size-3" /> {r.lastUsedSessionId ?? `${r.usageCount}×`}
                      </span>
                    )}
                  </div>
                  <button type="button" onClick={() => setExpanded(open ? null : r.id)} className="mt-1 block w-full text-left text-[12.5px] leading-snug" aria-expanded={open}>
                    {open ? <RichContent body={item.body} options={item.options} className="text-[12.5px]" /> : <span className="line-clamp-3">{r.plainText}</span>}
                  </button>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <QuestionMeta item={item} />
                    {inPaper ? (
                      <span className="text-[11px] font-medium text-muted-foreground">In paper</span>
                    ) : matching.length <= 1 ? (
                      <Button size="xs" variant="outline" onClick={() => onAdd(item, matching[0]?.key)} aria-label={`Add ${r.code}${matching[0] ? ` to section ${matching[0].label}` : ""}`}>
                        <Plus /> Add
                      </Button>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="xs" variant="outline" aria-label={`Add ${r.code} to a section`}>
                            <Plus /> Add <ChevronDown />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel className="text-xs">Add to section</DropdownMenuLabel>
                          {matching.map((s) => (
                            <DropdownMenuItem key={s.key} onSelect={() => onAdd(item, s.key)}>Section {s.label}</DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
        {rows.length < total && (
          <li>
            <Button variant="ghost" size="sm" className="w-full" disabled={loading} onClick={() => void load(page + 1)}>
              Load more
            </Button>
          </li>
        )}
      </ul>
    </div>
  );
}
