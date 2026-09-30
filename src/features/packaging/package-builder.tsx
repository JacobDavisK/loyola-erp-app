"use client";

import { useMemo, useState, useTransition } from "react";
import { Download, FileArchive, Files, Loader2, Package, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { buildPackageAction } from "@/features/packaging/actions";
import { cn } from "@/lib/utils";

export interface PackagePaper {
  id: string;
  code: string;
  course: string;
  title: string;
  session: string;
  examDate: string | null;
  status: string;
  version: string;
}

const FORMATS = [
  { key: "print", label: "Printing package", icon: Printer, desc: "ZIP: individual PDFs + batch PDF + manifest + printing instructions" },
  { key: "zip", label: "Individual PDFs", icon: Files, desc: "ZIP of one PDF per paper with SHA-256 manifest" },
  { key: "batch", label: "Batch PDF", icon: FileArchive, desc: "Single merged PDF in exam-date order" },
] as const;

export function PackageBuilder({ papers }: { papers: PackagePaper[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [format, setFormat] = useState<(typeof FORMATS)[number]["key"]>("print");
  const [result, setResult] = useState<{ url: string; fileName: string; count: number; bytes: number } | null>(null);
  const [pending, start] = useTransition();
  const sessions = useMemo(() => [...new Set(papers.map((p) => p.session))], [papers]);
  const [session, setSession] = useState(sessions[0] ?? "");
  const visible = papers.filter((p) => !session || p.session === session);
  const allSelected = visible.length > 0 && visible.every((p) => selected.includes(p.id));

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <section className="surface-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
          <select aria-label="Session" value={session} onChange={(e) => setSession(e.target.value)} className="h-8 rounded-lg border bg-card px-2 text-[13px]">
            <option value="">All sessions</option>
            {sessions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label className="ml-auto flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? [...new Set([...selected, ...visible.map((p) => p.id)])] : selected.filter((id) => !visible.some((p) => p.id === id)))} />
            Select all ({visible.length})
          </label>
        </div>
        {visible.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-muted-foreground">No locked papers yet. Papers appear here once they are approved and locked.</p>
        ) : (
          <ul className="divide-y">
            {visible.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-4 px-5 py-3 hover:bg-muted/40">
                  <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={selected.includes(p.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))} />
                  <span className="w-20 font-mono text-sm font-medium">{p.course}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{p.title}</span>
                  <span className="text-xs text-muted-foreground">{p.examDate ?? "No date"}</span>
                  <span className="text-xs text-muted-foreground">v{p.version}</span>
                  <span className="text-xs font-medium">{p.status}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <aside className="space-y-4 xl:sticky xl:top-20 xl:h-fit">
        <section className="surface-card p-4">
          <h2 className="mb-3 text-[13px] font-semibold">Package format</h2>
          <div className="space-y-2" role="radiogroup" aria-label="Package format">
            {FORMATS.map((f) => (
              <button key={f.key} type="button" role="radio" aria-checked={format === f.key} onClick={() => setFormat(f.key)} className={cn("flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors", format === f.key ? "border-primary bg-primary/5" : "hover:bg-muted/40")}>
                <f.icon className={cn("mt-0.5 size-4", format === f.key ? "text-primary" : "text-muted-foreground")} />
                <span>
                  <span className="block text-sm font-medium">{f.label}</span>
                  <span className="block text-xs text-muted-foreground">{f.desc}</span>
                </span>
              </button>
            ))}
          </div>
          <Button
            className="mt-4 w-full"
            disabled={!selected.length || pending}
            onClick={() =>
              start(async () => {
                setResult(null);
                const res = await buildPackageAction({ paperIds: selected, format });
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                setResult(res.data);
                toast.success(`Package ready — ${res.data.count} paper(s)`);
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : <Package />} {pending ? "Rendering final PDFs…" : `Build package (${selected.length})`}
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">Each paper is rendered from its immutable FINAL version, watermarked with your identity, and the export is recorded in the audit log.</p>
        </section>
        {result && (
          <section className="surface-card border-tone-success/40 p-4">
            <div className="text-sm font-semibold">{result.fileName}</div>
            <div className="text-xs text-muted-foreground">{result.count} paper(s) · {(result.bytes / 1024).toFixed(0)} KB · link valid for 5 minutes</div>
            <Button asChild className="mt-3 w-full"><a href={result.url}><Download /> Download package</a></Button>
          </section>
        )}
      </aside>
    </div>
  );
}
