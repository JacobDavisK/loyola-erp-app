"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDown, ArrowLeft, ArrowUp, CircleAlert, Eye, FilePlus2, GripVertical, Loader2, MessageSquareWarning, MoreHorizontal,
  PanelLeft, PanelRight, Plus, Replace, Save, Send, Sparkles, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import { RichContent } from "@/components/app/rich-content";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { savePaperAction, transitionPaperAction } from "@/features/papers/actions";
import type { PaperStatus } from "@/generated/prisma/enums";
import { paperMarks, sectionMarks, validateAgainstBlueprint } from "@/lib/domain/blueprint";
import { formatDuration, PAPER_STATUS } from "@/lib/domain/labels";
import type { BlueprintSpec, PaperItemData, PaperSnapshot } from "@/lib/domain/paper-types";
import { cn } from "@/lib/utils";
import { BankPanel, QuestionMeta } from "./bank-panel";
import { BlueprintPanel, CheckRow } from "./blueprint-panel";
import { GenerateDialog } from "./generate-dialog";
import type { BuilderSection, BuilderUnit } from "./types";

interface Props {
  paper: { id: string; code: string; status: PaperStatus; revision: number; instructions: string | null; courseId: string };
  snapshot: PaperSnapshot;
  blueprint: BlueprintSpec | null;
  units: BuilderUnit[];
  outcomes: { id: string; code: string; description: string }[];
  canGenerate: boolean;
  canCreateQuestion: boolean;
  comments: { id: string; itemId: string | null; kind: string; body: string; author: string; at: string }[];
}

let keySeq = 0;
const newKey = () => `s${++keySeq}-${Date.now().toString(36)}`;

export function PaperBuilder({ paper, snapshot, blueprint, units, canGenerate, canCreateQuestion, comments }: Props) {
  const router = useRouter();
  const [sections, setSections] = useState<BuilderSection[]>(() =>
    snapshot.sections.map((s) => ({
      key: newKey(),
      id: s.id,
      label: s.label,
      title: s.title,
      instructions: s.instructions,
      attemptCount: s.attemptCount,
      marksPerQuestion: s.marksPerQuestion,
      parentLabel: snapshot.sections.find((p) => p.id === s.parentId)?.label ?? null,
      items: s.items,
    })),
  );
  const [instructions, setInstructions] = useState(paper.instructions ?? "");
  const [dirty, setDirtyState] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saving, startSaving] = useTransition();
  const [submitting, startSubmit] = useTransition();
  const [conflict, setConflict] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateSections, setGenerateSections] = useState<string[] | undefined>();
  const [generateKey, setGenerateKey] = useState(0);
  const [editSection, setEditSection] = useState<BuilderSection | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<{ sectionKey: string; questionId: string; marks: number; code: string } | null>(null);
  const [showBank, setShowBank] = useState(true);
  const [showBlueprint, setShowBlueprint] = useState(true);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const dirtyRef = useRef(false);
  const setDirty = useCallback((v: boolean) => {
    dirtyRef.current = v;
    setDirtyState(v);
  }, []);
  // Source of truth for persistence. Updated synchronously on every edit so a save triggered
  // before React re-renders (e.g. Ctrl+S straight after "Apply") never sends stale content.
  const sectionsRef = useRef(sections);
  const instructionsRef = useRef(instructions);
  const revisionRef = useRef(paper.revision);
  const changeSeq = useRef(0);
  const saveChain = useRef<Promise<boolean>>(Promise.resolve(true));

  const editInstructions = (value: string) => {
    instructionsRef.current = value;
    changeSeq.current++;
    setInstructions(value);
    setDirty(true);
  };

  const itemComments = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of comments) if (c.itemId) m.set(c.itemId, (m.get(c.itemId) ?? 0) + 1);
    return m;
  }, [comments]);

  const mutate = useCallback((fn: (s: BuilderSection[]) => BuilderSection[]) => {
    sectionsRef.current = fn(sectionsRef.current);
    changeSeq.current++;
    setSections(sectionsRef.current);
    setDirty(true);
  }, [setDirty]);

  const report = useMemo(
    () =>
      blueprint
        ? validateAgainstBlueprint(
            sections.map((s) => ({ id: s.id ?? s.key, label: s.label, title: s.title, instructions: s.instructions, attemptCount: s.attemptCount, marksPerQuestion: s.marksPerQuestion, items: s.items })),
            blueprint,
          )
        : null,
    [sections, blueprint],
  );
  const totalMarks = paperMarks(sections);
  const questionCount = sections.reduce((n, s) => n + s.items.length, 0);
  const usedIds = sections.flatMap((s) => s.items.map((i) => i.questionId));

  // ── Persistence ────────────────────────────────────────
  const buildPayload = useCallback(
    (rev: number) => ({
      revision: rev,
      instructions: instructionsRef.current.trim() || null,
      sections: sectionsRef.current.map((s) => ({
        id: s.id,
        label: s.label,
        title: s.title,
        instructions: s.instructions?.trim() || null,
        attemptCount: s.attemptCount,
        marksPerQuestion: s.marksPerQuestion,
        parentLabel: s.parentLabel,
        items: s.items.map((i) => ({ questionId: i.questionId, marks: i.marks })),
      })),
    }),
    [],
  );

  /** Saves are serialised; each one sends the latest content and only marks the paper clean
   *  if nothing changed while it was in flight. */
  const save = useCallback(
    (opts?: { silent?: boolean }) => {
      const run = () =>
        new Promise<boolean>((resolve) => {
          startSaving(async () => {
            const seqAtStart = changeSeq.current;
            const res = await savePaperAction(paper.id, buildPayload(revisionRef.current));
            if (!res.ok) {
              if (res.code === "CONFLICT") setConflict(true);
              else toast.error(res.error, { description: "We couldn't save this paper." });
              return resolve(false);
            }
            revisionRef.current = res.data.revision;
            if (changeSeq.current === seqAtStart) setDirty(false);
            setSavedAt(new Date());
            if (!opts?.silent) toast.success("Paper saved");
            resolve(true);
          });
        });
      saveChain.current = saveChain.current.then(run, run);
      return saveChain.current;
    },
    [paper.id, buildPayload, setDirty],
  );

  // Autosave 6 s after the last change
  useEffect(() => {
    if (!dirty || conflict) return;
    const t = setTimeout(() => void save({ silent: true }), 6000);
    return () => clearTimeout(t);
  }, [dirty, sections, instructions, save, conflict]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Keyboard shortcuts: / search · Ctrl+S save · Ctrl+Enter submit · Esc cancel replace
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        setSubmitOpen(true);
      } else if (e.key === "/" && !typing) {
        e.preventDefault();
        setShowBank(true);
        setTimeout(() => searchRef.current?.focus(), 0);
      } else if (e.key === "Escape" && replaceTarget) {
        setReplaceTarget(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, replaceTarget]);

  // ── Editing operations ─────────────────────────────────
  const addItem = (item: PaperItemData, sectionKey?: string) => {
    if (usedIds.includes(item.questionId)) return toast.info(`${item.questionCode} is already in the paper.`);
    if (replaceTarget) {
      if (item.marks !== replaceTarget.marks) return toast.error(`Replacement must carry ${replaceTarget.marks} marks.`);
      mutate((prev) =>
        prev.map((s) => (s.key === replaceTarget.sectionKey ? { ...s, items: s.items.map((i) => (i.questionId === replaceTarget.questionId ? item : i)) } : s)),
      );
      toast.success(`${replaceTarget.code} replaced with ${item.questionCode}`);
      setReplaceTarget(null);
      return;
    }
    const key = sectionKey ?? sections.find((s) => s.marksPerQuestion === item.marks)?.key ?? sections[sections.length - 1]?.key;
    const target = sections.find((s) => s.key === key);
    if (!target) return;
    if (target.marksPerQuestion && target.marksPerQuestion !== item.marks) {
      toast.warning(`Section ${target.label} expects ${target.marksPerQuestion}-mark questions; ${item.questionCode} carries ${item.marks}.`);
    }
    mutate((prev) => prev.map((s) => (s.key === key ? { ...s, items: [...s.items, item] } : s)));
  };

  const removeItem = (sectionKey: string, questionId: string) =>
    mutate((prev) => prev.map((s) => (s.key === sectionKey ? { ...s, items: s.items.filter((i) => i.questionId !== questionId) } : s)));

  const moveItem = (questionId: string, toSectionKey: string, toIndex: number) =>
    mutate((prev) => {
      let moving: PaperItemData | undefined;
      const without = prev.map((s) => {
        const idx = s.items.findIndex((i) => i.questionId === questionId);
        if (idx < 0) return s;
        moving = s.items[idx];
        return { ...s, items: s.items.filter((_, i) => i !== idx) };
      });
      if (!moving) return prev;
      return without.map((s) => {
        if (s.key !== toSectionKey) return s;
        const items = [...s.items];
        items.splice(Math.max(0, Math.min(toIndex, items.length)), 0, moving!);
        return { ...s, items };
      });
    });

  const shift = (sectionKey: string, index: number, delta: number) => {
    const s = sections.find((x) => x.key === sectionKey);
    if (!s) return;
    const item = s.items[index];
    const target = index + delta;
    if (target < 0 || target >= s.items.length) return;
    moveItem(item.questionId, sectionKey, target);
  };

  const onDrop = (e: React.DragEvent, sectionKey: string, index: number) => {
    e.preventDefault();
    setDragOver(null);
    const moving = e.dataTransfer.getData("application/x-examcore-item");
    if (moving) return moveItem(moving, sectionKey, index);
    const q = e.dataTransfer.getData("application/x-examcore-question");
    if (q) {
      const item = JSON.parse(q) as PaperItemData;
      if (usedIds.includes(item.questionId)) return;
      mutate((prev) =>
        prev.map((s) => {
          if (s.key !== sectionKey) return s;
          const items = [...s.items];
          items.splice(index, 0, item);
          return { ...s, items };
        }),
      );
    }
  };

  const addSection = (parent?: BuilderSection) => {
    const used = new Set(sections.map((s) => s.label));
    let label = parent ? `${parent.label}1` : "A";
    if (parent) {
      let i = 1;
      while (used.has(`${parent.label}${i}`)) i++;
      label = `${parent.label}${i}`;
    } else {
      for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (!used.has(c)) { label = c; break; }
    }
    const s: BuilderSection = { key: newKey(), label, title: parent ? "Sub-section" : "New section", instructions: null, attemptCount: null, marksPerQuestion: parent?.marksPerQuestion ?? null, parentLabel: parent?.label ?? null, items: [] };
    mutate((prev) => {
      if (!parent) return [...prev, s];
      const idx = prev.findIndex((x) => x.key === parent.key);
      const copy = [...prev];
      copy.splice(idx + 1, 0, s);
      return copy;
    });
    setEditSection(s);
  };

  const submit = () =>
    startSubmit(async () => {
      if ((dirtyRef.current || changeSeq.current > 0) && !(await save({ silent: true }))) return;
      const action = paper.status === "REVISION_REQUIRED" ? "resubmit" : "submit";
      const res = await transitionPaperAction(paper.id, action);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(`Paper ${action === "resubmit" ? "resubmitted" : "submitted"} — version ${res.data.version}`);
      setSubmitOpen(false);
      router.push(`/papers/${paper.id}`);
    });

  // continuous numbering Q1…Qn
  let number = 0;
  const blockers = report ? report.checks.filter((c) => c.status === "fail" && (c.key === "marks" || c.key === "structure" || c.key === "duplicates")) : [];

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100vh-3.5rem)] flex-col sm:-mx-6 lg:-mx-8 lg:-my-8">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b bg-card px-4 py-2.5">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back to paper">
          <Link href={`/papers/${paper.id}`}><ArrowLeft /></Link>
        </Button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[15px] font-semibold">{snapshot.exam.courseCode} · {snapshot.exam.courseTitle}</h1>
            <StatusBadge meta={PAPER_STATUS[paper.status]} />
          </div>
          <div className="text-xs text-muted-foreground">
            {snapshot.exam.semesterName} · {snapshot.exam.maxMarks} marks · {formatDuration(snapshot.exam.durationMinutes)} · Set {snapshot.paper.setLabel}
          </div>
        </div>
        <div className="mx-auto hidden items-center gap-5 rounded-lg bg-muted/60 px-4 py-1.5 text-xs md:flex" aria-live="polite">
          <span><b className="tabular text-sm">{questionCount}</b> <span className="text-muted-foreground">questions</span></span>
          <span className={cn(blueprint && totalMarks !== blueprint.totalMarks && "text-tone-warning")}><b className="tabular text-sm">{totalMarks}</b> <span className="text-muted-foreground">/ {blueprint?.totalMarks ?? snapshot.exam.maxMarks} marks</span></span>
          {report && <span><b className="tabular text-sm">{report.compliance}%</b> <span className="text-muted-foreground">compliance</span></span>}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="mr-1 hidden text-xs text-muted-foreground lg:inline" aria-live="polite">
            {saving ? "Saving…" : dirty ? "Unsaved changes" : savedAt ? `Saved ${savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "All changes saved"}
          </span>
          <Button variant="ghost" size="icon-sm" onClick={() => setShowBank((v) => !v)} aria-pressed={showBank} aria-label="Toggle question bank panel" className="hidden lg:inline-flex"><PanelLeft /></Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setShowBlueprint((v) => !v)} aria-pressed={showBlueprint} aria-label="Toggle blueprint panel" className="hidden lg:inline-flex"><PanelRight /></Button>
          {canGenerate && blueprint && (
            <Button variant="outline" size="sm" onClick={() => { setGenerateSections(undefined); setGenerateKey((k) => k + 1); setGenerateOpen(true); }}>
              <Sparkles /> Generate
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href={`/papers/${paper.id}/preview`} target="_blank"><Eye /> Preview</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => void save()} disabled={saving || !dirty} title="Save (Ctrl+S)">
            {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
          </Button>
          <Button size="sm" onClick={() => setSubmitOpen(true)} title="Submit (Ctrl+Enter)">
            <Send /> {paper.status === "REVISION_REQUIRED" ? "Resubmit" : "Submit"}
          </Button>
        </div>
      </div>

      {comments.length > 0 && (
        <div className="flex items-center gap-2 border-b bg-tone-warning/8 px-4 py-2 text-xs text-tone-warning">
          <MessageSquareWarning className="size-4 shrink-0" />
          <span className="font-semibold">{comments.length} open review comment{comments.length === 1 ? "" : "s"}.</span>
          <span className="truncate text-foreground/80">Latest from {comments[0].author}: “{comments[0].body}”</span>
          <Link href={`/papers/${paper.id}#comments`} className="ml-auto shrink-0 font-medium underline">View all</Link>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* LEFT — Question bank */}
        {showBank && (
          <aside className="hidden w-[330px] shrink-0 flex-col border-r bg-surface/40 lg:flex" aria-label="Question bank">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <h2 className="text-[13px] font-semibold">Question bank</h2>
              {canCreateQuestion && (
                <Button asChild variant="ghost" size="xs">
                  <Link href={`/question-bank/new?courseId=${paper.courseId}`} target="_blank"><FilePlus2 /> New question</Link>
                </Button>
              )}
            </div>
            <AnimatePresence>
              {replaceTarget && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-b bg-primary/5">
                  <div className="flex items-center gap-2 px-3 py-2 text-xs">
                    <Replace className="size-3.5 text-primary" />
                    <span className="flex-1">Choose a {replaceTarget.marks}-mark replacement for <b>{replaceTarget.code}</b></span>
                    <Button variant="ghost" size="icon-xs" onClick={() => setReplaceTarget(null)} aria-label="Cancel replace"><X /></Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="min-h-0 flex-1">
              <BankPanel
                courseId={paper.courseId}
                units={units}
                usedIds={usedIds}
                sections={sections.map((s) => ({ key: s.key, label: s.label, marksPerQuestion: s.marksPerQuestion }))}
                onAdd={addItem}
                searchRef={searchRef}
                presetMarks={replaceTarget?.marks ?? null}
              />
            </div>
          </aside>
        )}

        {/* CENTER — Paper canvas */}
        <div className="min-w-0 flex-1 overflow-y-auto bg-background">
          <div className="mx-auto max-w-[820px] space-y-5 px-4 py-6 sm:px-8">
            <div className="surface-card p-5">
              <Label htmlFor="paper-instructions" className="eyebrow">General instructions to candidates</Label>
              <Textarea
                id="paper-instructions"
                value={instructions}
                onChange={(e) => editInstructions(e.target.value)}
                rows={3}
                className="mt-2 resize-y text-sm"
                placeholder="e.g. Answer the questions as directed in each section."
              />
            </div>

            {sections.map((s) => {
              const secMarks = sectionMarks(s);
              const spec = blueprint?.sections.find((b) => b.label === s.label);
              return (
                <section
                  key={s.key}
                  aria-label={`Section ${s.label}`}
                  className={cn("surface-card overflow-hidden transition-shadow", s.parentLabel && "ml-6", dragOver === s.key && "ring-2 ring-primary/40")}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(s.key); }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null); }}
                  onDrop={(e) => onDrop(e, s.key, s.items.length)}
                >
                  <div className="flex items-start gap-3 border-b bg-surface/50 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <h2 className="text-sm font-semibold tracking-wide">SECTION {s.label}</h2>
                        <span className="text-sm text-muted-foreground">{s.title}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {s.items.length}{spec ? `/${spec.questionCount}` : ""} questions
                        {s.attemptCount ? ` · answer any ${s.attemptCount}` : ""}
                        {s.marksPerQuestion ? ` · ${s.attemptCount ?? s.items.length} × ${s.marksPerQuestion} = ${(s.attemptCount ?? s.items.length) * s.marksPerQuestion}` : ""}
                        {" · "}<span className={cn(spec && secMarks !== spec.attemptCount * spec.marksPerQuestion && "font-medium text-tone-warning")}>{secMarks} marks</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {canGenerate && blueprint && spec && (
                        <Button variant="ghost" size="xs" onClick={() => { setGenerateSections([s.label]); setGenerateKey((k) => k + 1); setGenerateOpen(true); }} title={`Regenerate section ${s.label}`}>
                          <Sparkles /> <span className="hidden sm:inline">Regenerate</span>
                        </Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-xs" aria-label={`Section ${s.label} options`}><MoreHorizontal /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditSection(s)}>Edit section</DropdownMenuItem>
                          {!s.parentLabel && <DropdownMenuItem onSelect={() => addSection(s)}>Add sub-section</DropdownMenuItem>}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={sections.length === 1}
                            onSelect={() => {
                              if (s.items.length && !confirm(`Remove section ${s.label} and its ${s.items.length} question(s)?`)) return;
                              mutate((prev) => prev.filter((x) => x.key !== s.key && x.parentLabel !== s.label));
                            }}
                          >
                            Remove section
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {s.instructions && <p className="border-b px-5 py-2 text-xs text-muted-foreground italic">{s.instructions}</p>}

                  <ol className="divide-y">
                    {s.items.map((item, idx) => {
                      number++;
                      const n = number;
                      const open = itemComments.get(item.itemId) ?? 0;
                      return (
                        <li
                          key={item.questionId}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("application/x-examcore-item", item.questionId);
                            e.dataTransfer.effectAllowed = "move";
                          }}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => { e.stopPropagation(); onDrop(e, s.key, idx); }}
                          className={cn("group relative flex gap-3 px-5 py-3.5 hover:bg-muted/30", replaceTarget?.questionId === item.questionId && "bg-primary/5 ring-1 ring-primary/30 ring-inset")}
                        >
                          <GripVertical aria-hidden className="mt-0.5 size-4 shrink-0 cursor-grab text-muted-foreground/40 group-hover:text-muted-foreground" />
                          <span className="w-8 shrink-0 pt-px text-sm font-semibold tabular">Q{n}.</span>
                          <div className="min-w-0 flex-1">
                            <RichContent body={item.body} options={item.options} className="font-paper text-[15px]" />
                            <div className="mt-2 flex flex-wrap items-center gap-3">
                              <QuestionMeta item={item} />
                              <span className="font-mono text-[10.5px] text-muted-foreground/70">{item.questionCode} v{item.version}</span>
                              {open > 0 && <span className="flex items-center gap-1 text-[11px] font-medium text-tone-warning"><CircleAlert className="size-3" /> {open} comment{open > 1 ? "s" : ""}</span>}
                            </div>
                          </div>
                          <span className={cn("shrink-0 pt-px text-sm font-semibold tabular", s.marksPerQuestion && item.marks !== s.marksPerQuestion && "text-tone-danger")}>[{item.marks}]</span>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-xs" className="shrink-0 opacity-60 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Actions for Q${n}`}><MoreHorizontal /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              <DropdownMenuItem disabled={idx === 0} onSelect={() => shift(s.key, idx, -1)}><ArrowUp /> Move up</DropdownMenuItem>
                              <DropdownMenuItem disabled={idx === s.items.length - 1} onSelect={() => shift(s.key, idx, 1)}><ArrowDown /> Move down</DropdownMenuItem>
                              {sections.length > 1 && <DropdownMenuLabel className="text-xs">Move to</DropdownMenuLabel>}
                              {sections.filter((x) => x.key !== s.key).map((x) => (
                                <DropdownMenuItem key={x.key} onSelect={() => moveItem(item.questionId, x.key, x.items.length)}>Section {x.label}</DropdownMenuItem>
                              ))}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onSelect={() => { setShowBank(true); setReplaceTarget({ sectionKey: s.key, questionId: item.questionId, marks: item.marks, code: item.questionCode }); }}>
                                <Replace /> Replace…
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild>
                                <Link href={`/question-bank/${item.questionId}`} target="_blank">Open in question bank</Link>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onSelect={() => removeItem(s.key, item.questionId)}><Trash2 /> Remove</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </li>
                      );
                    })}
                  </ol>
                  {spec && s.items.length < spec.questionCount && (
                    <div className={cn("m-3 rounded-lg border border-dashed px-4 py-4 text-center text-xs text-muted-foreground", dragOver === s.key && "border-primary/50 bg-primary/5 text-primary")}>
                      {spec.questionCount - s.items.length} more {spec.marksPerQuestion}-mark question{spec.questionCount - s.items.length === 1 ? "" : "s"} needed — drag from the bank, use <b>Add</b>, or regenerate this section.
                    </div>
                  )}
                  {!spec && s.items.length === 0 && (
                    <div className="m-3 rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">Drop questions here</div>
                  )}
                </section>
              );
            })}

            <Button variant="outline" className="w-full border-dashed" onClick={() => addSection()}>
              <Plus /> Add section
            </Button>
          </div>
        </div>

        {/* RIGHT — Blueprint validation */}
        {showBlueprint && (
          <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-l bg-card xl:block" aria-label="Blueprint validation">
            <div className="border-b px-4 py-2.5">
              <h2 className="text-[13px] font-semibold">Blueprint</h2>
            </div>
            <BlueprintPanel report={report} />
          </aside>
        )}
      </div>

      {/* Section editor */}
      <Dialog open={!!editSection} onOpenChange={(o) => !o && setEditSection(null)}>
        <DialogContent>
          {editSection && (
            <SectionEditor
              section={editSection}
              existingLabels={sections.filter((x) => x.key !== editSection.key).map((x) => x.label)}
              onSave={(patch) => {
                const oldLabel = editSection.label;
                mutate((prev) => prev.map((x) => (x.key === editSection.key ? { ...x, ...patch } : x.parentLabel === oldLabel ? { ...x, parentLabel: patch.label ?? x.parentLabel } : x)));
                setEditSection(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Submit confirmation */}
      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{paper.status === "REVISION_REQUIRED" ? "Resubmit paper" : "Submit paper for moderation"}</DialogTitle>
            <DialogDescription>
              An immutable version is recorded and the moderator is notified. You won&apos;t be able to edit the paper unless it is returned for revision.
            </DialogDescription>
          </DialogHeader>
          {report && (
            <ul className="rounded-lg border p-3">
              {report.checks.map((c) => <CheckRow key={c.key} status={c.status} label={c.label} detail={c.detail} />)}
            </ul>
          )}
          {blockers.length > 0 && (
            <p className="text-sm text-destructive">Fix the marks and section structure before submitting.</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitOpen(false)}>Keep editing</Button>
            <Button onClick={submit} disabled={submitting || blockers.length > 0}>
              {submitting && <Loader2 className="animate-spin" />} {paper.status === "REVISION_REQUIRED" ? "Resubmit" : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Conflict */}
      <Dialog open={conflict} onOpenChange={() => {}}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Paper updated elsewhere</DialogTitle>
            <DialogDescription>
              Another authorised user modified this paper while you were editing. Your unsaved changes were not applied, so nothing was overwritten.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => { setDirty(false); window.location.reload(); }}>Review changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GenerateDialog
        key={generateKey}
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        paperId={paper.id}
        initialSections={generateSections}
        sections={sections.filter((s) => blueprint?.sections.some((b) => b.label === s.label)).map((s) => ({ label: s.label, questionIds: s.items.map((i) => i.questionId) }))}
        onApply={(bySection) => mutate((prev) => prev.map((s) => (bySection[s.label] ? { ...s, items: bySection[s.label] } : s)))}
      />
    </div>
  );
}

function SectionEditor({ section, existingLabels, onSave }: { section: BuilderSection; existingLabels: string[]; onSave: (patch: Partial<BuilderSection>) => void }) {
  const [label, setLabel] = useState(section.label);
  const [title, setTitle] = useState(section.title);
  const [instructions, setInstructions] = useState(section.instructions ?? "");
  const [attempt, setAttempt] = useState(section.attemptCount ? String(section.attemptCount) : "");
  const [mpq, setMpq] = useState(section.marksPerQuestion ? String(section.marksPerQuestion) : "");
  const clash = existingLabels.includes(label.trim().toUpperCase());
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (clash || !label.trim() || !title.trim()) return;
        onSave({ label: label.trim().toUpperCase(), title: title.trim(), instructions: instructions.trim() || null, attemptCount: attempt ? Number(attempt) : null, marksPerQuestion: mpq ? Number(mpq) : null });
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>Edit section</DialogTitle>
      </DialogHeader>
      <div className="grid grid-cols-[90px_1fr] gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="sec-label">Label</Label>
          <Input id="sec-label" value={label} maxLength={8} onChange={(e) => setLabel(e.target.value)} aria-invalid={clash} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sec-title">Title</Label>
          <Input id="sec-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
      </div>
      {clash && <p className="text-xs text-destructive">Another section already uses label {label.toUpperCase()}.</p>}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="sec-attempt">Answer any (optional)</Label>
          <Input id="sec-attempt" type="number" min={1} value={attempt} onChange={(e) => setAttempt(e.target.value)} placeholder="All" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sec-mpq">Marks per question</Label>
          <Input id="sec-mpq" type="number" min={1} value={mpq} onChange={(e) => setMpq(e.target.value)} placeholder="Varies" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sec-ins">Section instructions</Label>
        <Textarea id="sec-ins" rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={clash}>Apply</Button>
      </DialogFooter>
    </form>
  );
}
