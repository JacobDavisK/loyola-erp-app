"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, Circle, Loader2, MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { addCommentAction, resolveCommentAction } from "@/features/papers/actions";
import { fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface CommentView {
  id: string;
  kind: string;
  body: string;
  author: string;
  at: string;
  resolved: boolean;
  itemLabel: string | null;
}

const KIND: Record<string, { label: string; cls: string }> = {
  COMMENT: { label: "Comment", cls: "bg-muted text-muted-foreground" },
  ISSUE: { label: "Issue", cls: "bg-tone-danger/10 text-tone-danger" },
  SUGGEST_REPLACEMENT: { label: "Suggest replacement", cls: "bg-tone-progress/10 text-tone-progress" },
  REPLACED: { label: "Replaced", cls: "bg-tone-info/10 text-tone-info" },
};

export function CommentThread({
  paperId,
  comments,
  canComment,
  canResolve,
  items,
}: {
  paperId: string;
  comments: CommentView[];
  canComment: boolean;
  canResolve: boolean;
  items?: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [kind, setKind] = useState("COMMENT");
  const [itemId, setItemId] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      {canComment && (
        <form
          className="space-y-2 rounded-lg border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await addCommentAction(paperId, { body, kind, itemId: itemId || null });
              if (!res.ok) {
                toast.error(res.error);
                return;
              }
              setBody("");
              router.refresh();
            });
          }}
        >
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Add a remark for the setter and reviewers…" aria-label="Comment" />
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Comment type" value={kind} onChange={(e) => setKind(e.target.value)} className="h-8 rounded-md border bg-card px-2 text-xs">
              <option value="COMMENT">Comment</option>
              <option value="ISSUE">Issue</option>
              <option value="SUGGEST_REPLACEMENT">Suggest replacement</option>
            </select>
            {items && items.length > 0 && (
              <select aria-label="Question" value={itemId} onChange={(e) => setItemId(e.target.value)} className="h-8 rounded-md border bg-card px-2 text-xs">
                <option value="">Whole paper</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>{i.label}</option>
                ))}
              </select>
            )}
            <Button type="submit" size="sm" className="ml-auto" disabled={pending || body.trim().length < 2}>
              {pending ? <Loader2 className="animate-spin" /> : <MessageSquarePlus />} Add
            </Button>
          </div>
        </form>
      )}
      {comments.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No review comments.</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className={cn("rounded-lg border p-3", c.resolved && "opacity-60")}>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={cn("rounded px-1.5 py-0.5 font-medium", KIND[c.kind]?.cls)}>{KIND[c.kind]?.label ?? c.kind}</span>
                {c.itemLabel && <span className="font-mono text-muted-foreground">{c.itemLabel}</span>}
                <span className="font-medium">{c.author}</span>
                <span className="text-muted-foreground">{fmtRelative(c.at)}</span>
                {canResolve && c.kind !== "REPLACED" && (
                  <button
                    type="button"
                    className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      start(async () => {
                        await resolveCommentAction(c.id, paperId);
                        router.refresh();
                      })
                    }
                  >
                    {c.resolved ? <CheckCircle2 className="size-3.5 text-tone-success" /> : <Circle className="size-3.5" />}
                    {c.resolved ? "Resolved" : "Mark resolved"}
                  </button>
                )}
              </div>
              <p className="mt-1.5 text-sm whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
