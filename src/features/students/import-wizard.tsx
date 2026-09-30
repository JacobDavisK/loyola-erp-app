"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { CheckCircle2, CircleAlert, FileUp, Loader2, TriangleAlert, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { commitImportAction, jobStatusAction, previewImportAction } from "@/features/students/actions";
import { cn } from "@/lib/utils";
import type { ImportPreview } from "@/server/services/student-import";

type Job = { status: string; progress: number; error: string | null; result: Record<string, unknown> | null };

export function ImportWizard({ columns }: { columns: readonly string[] }) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const tick = async () => {
      const r = await jobStatusAction(jobId);
      if (stop || !r.ok) return;
      setJob(r.data);
      if (r.data.status === "QUEUED" || r.data.status === "RUNNING") setTimeout(tick, 1500);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [jobId]);

  const template = `${columns.join(",")}\r\n`;
  const errors = preview?.rows.filter((r) => r.errors.length) ?? [];
  const shown = preview ? (showAll ? preview.rows : [...errors, ...preview.rows.filter((r) => !r.errors.length && r.warnings.length)].slice(0, 200)) : [];

  if (jobId) {
    const running = !job || job.status === "QUEUED" || job.status === "RUNNING";
    return (
      <section className="surface-card space-y-4 p-6" aria-live="polite">
        {running && (
          <>
            <div className="flex items-center gap-2 text-sm font-medium"><Loader2 className="size-4 animate-spin" /> {job?.status === "RUNNING" ? "Importing…" : "Queued — waiting for the background worker"}</div>
            <Progress value={job?.progress ?? 0} aria-label="Import progress" />
            {job?.status === "QUEUED" && <p className="text-xs text-muted-foreground">If this does not start within a minute, the worker is not running. An administrator can check <Link href="/admin/system" className="underline">System health</Link>.</p>}
          </>
        )}
        {job?.status === "SUCCEEDED" && (
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-5 text-tone-success" />
            <div>
              <p className="font-medium">{String(job.result?.created ?? 0)} students imported</p>
              <p className="text-sm text-muted-foreground">Student numbers {String(job.result?.first ?? "")} to {String(job.result?.last ?? "")}.</p>
              <Button asChild size="sm" className="mt-3"><Link href="/students?sort=-admitted">View students</Link></Button>
            </div>
          </div>
        )}
        {job?.status === "FAILED" && (
          <div className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 size-5 text-tone-danger" />
            <div>
              <p className="font-medium">The import failed and was rolled back — no students were created.</p>
              <p className="text-sm text-muted-foreground">{job.error}</p>
              <Button size="sm" variant="outline" className="mt-3" onClick={() => { setJobId(null); setJob(null); setPreview(null); setFile(null); }}>Start again</Button>
            </div>
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="surface-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl space-y-1 text-sm">
            <h2 className="font-semibold">1. Prepare a CSV file</h2>
            <p className="text-muted-foreground">One student per row. Required columns: first_name, last_name, email, program_code, batch_code, admitted_on (YYYY-MM-DD). Up to 5,000 rows per file.</p>
          </div>
          <Button asChild size="sm" variant="outline"><a href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`} download="student-import-template.csv">Download template</a></Button>
        </div>
        <label className="mt-5 flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center hover:bg-muted/40">
          <FileUp aria-hidden className="size-6 text-muted-foreground" />
          <span className="text-sm font-medium">{file ? file.name : "Choose a CSV file"}</span>
          <span className="text-xs text-muted-foreground">The file is checked first. Nothing is saved until you confirm.</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 5_000_000) return toast.error("The file is larger than 5 MB.");
              const text = await f.text();
              setFile({ name: f.name, text });
              setPreview(null);
              start(async () => {
                const r = await previewImportAction(text);
                if (!r.ok) toast.error(r.error);
                else setPreview(r.data);
              });
            }}
          />
        </label>
        {pending && !preview && <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Checking the file…</p>}
      </section>

      {preview && (
        <section className="surface-card overflow-hidden">
          <div className="flex flex-wrap items-center gap-4 border-b px-5 py-4">
            <h2 className="text-sm font-semibold">2. Review</h2>
            <span className="text-sm tabular">{preview.total} rows</span>
            <span className="flex items-center gap-1 text-sm text-tone-success"><CheckCircle2 className="size-4" /> {preview.valid} valid</span>
            {errors.length > 0 && <span className="flex items-center gap-1 text-sm text-tone-danger"><CircleAlert className="size-4" /> {errors.length} with errors</span>}
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setShowAll((x) => !x)}>{showAll ? "Show problems only" : "Show all rows"}</Button>
              <Button
                size="sm"
                disabled={pending || errors.length > 0 || preview.valid === 0}
                onClick={() =>
                  start(async () => {
                    const r = await commitImportAction(file!.text, file!.name);
                    if (!r.ok) toast.error(r.error);
                    else setJobId(r.data.jobId);
                  })
                }
              >
                {pending ? <Loader2 className="animate-spin" /> : <Upload />} Import {preview.valid} students
              </Button>
            </div>
          </div>
          {preview.missingColumns.length > 0 && <p className="border-b px-5 py-3 text-sm text-tone-danger">Missing required column(s): {preview.missingColumns.join(", ")}</p>}
          {preview.unknownColumns.length > 0 && <p className="border-b px-5 py-3 text-sm text-muted-foreground">Ignored column(s): {preview.unknownColumns.join(", ")}</p>}
          {errors.length > 0 && <p className="border-b bg-tone-danger/5 px-5 py-3 text-sm">Fix the rows below in your file and upload it again. The import is all-or-nothing, so no row is saved while any row has an error.</p>}
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-5 py-2 font-medium">Line</th>
                  <th scope="col" className="px-4 py-2 font-medium">Name</th>
                  <th scope="col" className="px-4 py-2 font-medium">Programme / batch</th>
                  <th scope="col" className="px-4 py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {shown.map((r) => (
                  <tr key={r.line} className={cn(r.errors.length && "bg-tone-danger/5")}>
                    <td className="px-5 py-2 tabular">{r.line}</td>
                    <td className="px-4 py-2">{r.name || "—"}</td>
                    <td className="px-4 py-2 text-xs">{r.program} · {r.batch}</td>
                    <td className="px-4 py-2 text-xs">
                      {r.errors.map((e) => <div key={e} className="flex gap-1 text-tone-danger"><CircleAlert className="size-3.5 shrink-0" /> {e}</div>)}
                      {r.warnings.map((w) => <div key={w} className="flex gap-1 text-tone-warning"><TriangleAlert className="size-3.5 shrink-0" /> {w}</div>)}
                      {!r.errors.length && !r.warnings.length && <span className="text-tone-success">Ready</span>}
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={4} className="px-5 py-6 text-center text-sm text-muted-foreground">Every row is valid.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
