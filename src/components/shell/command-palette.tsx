"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, Building2, ClipboardList, FileText, Library, Loader2, UserRound } from "lucide-react";
import {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut,
} from "@/components/ui/command";
import { searchEverything } from "@/features/shell/actions";
import type { SearchHit } from "@/server/services/search";

export interface PaletteCommand {
  label: string;
  href: string;
  group: "Create" | "Go to";
  shortcut?: string;
}

const CATEGORY_ICON = {
  Courses: BookOpen,
  Questions: Library,
  Papers: FileText,
  Examinations: ClipboardList,
  Users: UserRound,
  Departments: Building2,
} as const;

export function CommandPalette({ open, onOpenChange, commands }: { open: boolean; onOpenChange: (o: boolean) => void; commands: PaletteCommand[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const close = (o: boolean) => {
    if (!o) {
      setQuery("");
      setHits([]);
    }
    onOpenChange(o);
  };

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const id = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const res = await searchEverything(q);
      if (id !== seq.current) return;
      setHits(res.ok ? res.data : []);
      setLoading(false);
    }, 180);
    return () => clearTimeout(t);
  }, [query]);

  const go = (href: string) => {
    close(false);
    router.push(href);
  };

  const visibleHits = query.trim().length < 2 ? [] : hits;
  const grouped = visibleHits.reduce<Record<string, SearchHit[]>>((acc, h) => {
    (acc[h.category] ??= []).push(h);
    return acc;
  }, {});

  return (
    <CommandDialog open={open} onOpenChange={close} title="Command palette" description="Search or run a command">
      <Command shouldFilter={false}>
      <CommandInput placeholder="Search or type a command…" value={query} onValueChange={setQuery} />
      <CommandList className="max-h-[420px]">
        {loading && query.trim().length >= 2 && (
          <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Searching…
          </div>
        )}
        <CommandEmpty>{query.trim().length < 2 ? "Type at least two characters to search." : "No results found."}</CommandEmpty>
        {Object.entries(grouped).map(([cat, list]) => {
          const Icon = CATEGORY_ICON[cat as keyof typeof CATEGORY_ICON];
          return (
            <CommandGroup key={cat} heading={cat}>
              {list.map((h) => (
                <CommandItem key={`${cat}-${h.id}`} value={`${cat}-${h.id}`} onSelect={() => go(h.href)}>
                  <Icon className="text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{h.title}</div>
                    {h.subtitle && <div className="truncate text-xs text-muted-foreground">{h.subtitle}</div>}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
        {visibleHits.length > 0 && <CommandSeparator />}
        {(["Create", "Go to"] as const).map((group) => {
          const list = commands.filter((c) => c.group === group && (!query || c.label.toLowerCase().includes(query.toLowerCase())));
          if (!list.length) return null;
          return (
            <CommandGroup key={group} heading={group}>
              {list.map((c) => (
                <CommandItem key={c.href + c.label} value={c.label} onSelect={() => go(c.href)}>
                  <ArrowRight className="text-muted-foreground" />
                  {c.label}
                  {c.shortcut && <CommandShortcut>{c.shortcut}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
      </Command>
    </CommandDialog>
  );
}
