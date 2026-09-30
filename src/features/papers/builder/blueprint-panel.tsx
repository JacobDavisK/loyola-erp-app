"use client";

import { AlertTriangle, CheckCircle2, CircleX } from "lucide-react";
import type { BlueprintReport, CheckStatus } from "@/lib/domain/blueprint";
import { BLOOM_LABEL, DIFFICULTY_LABEL, QUESTION_TYPE_LABEL } from "@/lib/domain/labels";
import { cn } from "@/lib/utils";

const ICON: Record<CheckStatus, typeof CheckCircle2> = { pass: CheckCircle2, warn: AlertTriangle, fail: CircleX };
const TONE: Record<CheckStatus, string> = { pass: "text-tone-success", warn: "text-tone-warning", fail: "text-tone-danger" };
const STATUS_TEXT: Record<CheckStatus, string> = { pass: "Satisfied", warn: "Needs attention", fail: "Not satisfied" };

export function CheckRow({ status, label, detail }: { status: CheckStatus; label: string; detail?: string }) {
  const Icon = ICON[status];
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", TONE[status])} />
      <div className="min-w-0 text-[13px]">
        <div className="font-medium">
          {label}
          <span className="sr-only">: {STATUS_TEXT[status]}</span>
        </div>
        {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
      </div>
    </li>
  );
}

function keyLabel(dim: string, key: string) {
  if (dim === "DIFFICULTY") return DIFFICULTY_LABEL[key as keyof typeof DIFFICULTY_LABEL] ?? key;
  if (dim === "BLOOM") return BLOOM_LABEL[key as keyof typeof BLOOM_LABEL] ?? key;
  if (dim === "UNIT") return `Unit ${key}`;
  if (dim === "QUESTION_TYPE") return QUESTION_TYPE_LABEL[key as keyof typeof QUESTION_TYPE_LABEL] ?? key;
  return key;
}

export function Distribution({ title, dim, rows }: { title: string; dim: string; rows: BlueprintReport["distributions"]["DIFFICULTY"] }) {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => (b.target ?? -1) - (a.target ?? -1) || a.key.localeCompare(b.key));
  return (
    <div>
      <div className="eyebrow mb-2">{title}</div>
      <ul className="space-y-2">
        {sorted.map((r) => (
          <li key={r.key} className="text-[12.5px]">
            <div className="flex items-center justify-between gap-2">
              <span>{keyLabel(dim, r.key)}</span>
              <span className={cn("tabular", r.target != null && r.status !== "pass" && TONE[r.status])}>
                {r.actual}%{r.target != null && <span className="text-muted-foreground"> / {r.target}%</span>}
                {r.target != null && r.status !== "pass" && <span className="sr-only"> — outside tolerance</span>}
              </span>
            </div>
            <div className="relative mt-1 h-1.5 rounded-full bg-muted" aria-hidden>
              <div
                className={cn("absolute inset-y-0 left-0 rounded-full", r.target == null ? "bg-muted-foreground/40" : r.status === "pass" ? "bg-primary" : r.status === "warn" ? "bg-tone-warning" : "bg-tone-danger")}
                style={{ width: `${Math.min(100, r.actual)}%` }}
              />
              {r.target != null && <div className="absolute -top-0.5 h-2.5 w-0.5 rounded bg-foreground/60" style={{ left: `${Math.min(100, r.target)}%` }} />}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ComplianceRing({ value }: { value: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const tone = value >= 90 ? "text-tone-success" : value >= 70 ? "text-tone-warning" : "text-tone-danger";
  return (
    <div className="relative size-16" role="img" aria-label={`Blueprint compliance ${value} percent`}>
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
        <circle cx="32" cy="32" r={r} className="fill-none stroke-muted" strokeWidth="6" />
        <circle cx="32" cy="32" r={r} className={cn("fill-none stroke-current transition-[stroke-dashoffset] duration-500", tone)} strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-sm font-semibold tabular">{value}%</div>
    </div>
  );
}

export function BlueprintPanel({ report }: { report: BlueprintReport | null }) {
  if (!report) {
    return <p className="p-4 text-sm text-muted-foreground">No blueprint is attached to this paper. Marks and structure are not validated automatically.</p>;
  }
  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center gap-4">
        <ComplianceRing value={report.compliance} />
        <div>
          <div className="text-xs text-muted-foreground">Blueprint compliance</div>
          <div className="mt-0.5 text-sm">
            <b className="tabular">{report.totalQuestions}</b>
            <span className="text-muted-foreground">/{report.requiredQuestions} questions</span>
          </div>
          <div className="text-sm">
            <b className="tabular">{report.totalMarks}</b>
            <span className="text-muted-foreground">/{report.requiredMarks} marks</span>
          </div>
        </div>
      </div>
      <ul aria-label="Blueprint checks">
        {report.checks.map((c) => (
          <CheckRow key={c.key} status={c.status} label={c.label} detail={c.detail} />
        ))}
      </ul>
      <div>
        <div className="eyebrow mb-2">Sections</div>
        <ul className="space-y-1.5 text-[12.5px]">
          {report.sections.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                {(() => {
                  const I = ICON[s.status];
                  return <I aria-hidden className={cn("size-3.5", TONE[s.status])} />;
                })()}
                Section {s.label}
              </span>
              <span className="tabular text-muted-foreground">
                {s.actualCount}/{s.requiredCount} · {s.marks}/{s.requiredMarks} m
              </span>
            </li>
          ))}
        </ul>
      </div>
      <Distribution title="Difficulty" dim="DIFFICULTY" rows={report.distributions.DIFFICULTY} />
      <Distribution title="Bloom's taxonomy" dim="BLOOM" rows={report.distributions.BLOOM} />
      <Distribution title="Unit weightage" dim="UNIT" rows={report.distributions.UNIT} />
    </div>
  );
}
