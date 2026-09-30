"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { searchStaffAction } from "@/features/workflow/actions";
import { cn } from "@/lib/utils";

export interface StaffOption {
  id: string;
  name: string;
  subtitle: string;
}

/** Accessible type-ahead for choosing a colleague (combobox pattern). */
export function StaffPicker({
  value,
  onChange,
  label = "Colleague",
  search = searchStaffAction,
  placeholder = "Type a name or ID",
}: {
  value: StaffOption | null;
  onChange: (v: StaffOption | null) => void;
  label?: string;
  /** server action returning matches; defaults to the staff directory */
  search?: (q: string) => Promise<{ ok: true; data: StaffOption[] } | { ok: false; error: string }>;
  placeholder?: string;
}) {
  const id = useId();
  const [q, setQ] = useState(value?.name ?? "");
  const [results, setResults] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2 || (value && term === value.name)) return;
    const n = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const r = await search(term);
      if (n !== seq.current) return;
      setResults(r.ok ? r.data : []);
      setLoading(false);
      setOpen(true);
      setActive(0);
    }, 200);
    return () => clearTimeout(t);
  }, [q, value, search]);

  const pick = (o: StaffOption) => {
    onChange(o);
    setQ(o.name);
    setOpen(false);
  };

  return (
    <div className="relative space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <div className="relative">
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder={placeholder}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (value) onChange(null);
          }}
          onKeyDown={(e) => {
            if (!open || !results.length) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            if (e.key === "Enter") { e.preventDefault(); pick(results[active]); }
            if (e.key === "Escape") setOpen(false);
          }}
          className="h-9 w-full rounded-lg border bg-card px-2.5 pr-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
        />
        {loading && <Loader2 aria-hidden className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        {value && !loading && <Check aria-hidden className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-tone-success" />}
      </div>
      {open && (
        <ul id={`${id}-list`} role="listbox" className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border bg-popover p-1 shadow-md">
          {results.length === 0 && <li className="px-2.5 py-2 text-sm text-muted-foreground">No matches.</li>}
          {results.map((o, i) => (
            <li
              key={o.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              onMouseEnter={() => setActive(i)}
              className={cn("cursor-pointer rounded-md px-2.5 py-1.5 text-sm", i === active && "bg-muted")}
            >
              <div>{o.name}</div>
              {o.subtitle && <div className="text-xs text-muted-foreground">{o.subtitle}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
