"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Power, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { publishDefinitionAction, setDefinitionActiveAction } from "@/features/workflow/actions";
import type { ApproverRule, Condition, WorkflowStep } from "@/lib/domain/workflow-engine";

const field = "h-9 w-full rounded-lg border bg-card px-2.5 text-sm";
type Opt = { value: string; label: string };

interface EditableStep extends Omit<WorkflowStep, "condition"> {
  conditionText: string;
}

const toEditable = (s: WorkflowStep): EditableStep => ({ ...s, conditionText: s.condition ? JSON.stringify(s.condition) : "" });

function parseCondition(text: string): Condition | undefined {
  const t = text.trim();
  if (!t) return undefined;
  return JSON.parse(t) as Condition;
}

/**
 * Structured editor for a workflow definition. Conditions use a small JSON form, e.g.
 * {"field":"days","op":"gt","value":3} or {"all":[…]} — validated on the server before publishing.
 */
export function StepsEditor({ workflowKey, name: initialName, description: initialDescription, steps: initial, version, active, roles }: { workflowKey: string; name: string; description: string; steps: WorkflowStep[]; version: number; active: boolean; roles: Opt[] }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [steps, setSteps] = useState<EditableStep[]>(initial.map(toEditable));
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(steps) !== JSON.stringify(initial.map(toEditable)) || name !== initialName || description !== initialDescription;

  const patch = (i: number, p: Partial<EditableStep>) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const patchRule = (i: number, r: number, rule: ApproverRule) => patch(i, { approvers: steps[i].approvers.map((x, j) => (j === r ? rule : x)) });
  const move = (i: number, d: -1 | 1) => setSteps((s) => { const n = [...s]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); return n; });

  const publish = () =>
    start(async () => {
      let payload: WorkflowStep[];
      try {
        payload = steps.map(({ conditionText, ...s }) => ({ ...s, condition: parseCondition(conditionText) }));
      } catch {
        toast.error("A condition is not valid JSON.");
        return;
      }
      const r = await publishDefinitionAction(workflowKey, { name, description, steps: payload });
      if (!r.ok) {
        toast.error(r.error, { description: r.fieldErrors ? Object.entries(r.fieldErrors).map(([k, v]) => `${k}: ${v.join(", ")}`).join(" · ") : undefined });
        return;
      }
      toast.success(`Version ${r.data.version} published`);
      router.refresh();
    });

  return (
    <Section
      title={`${initialName} — version ${version}`}
      description={active ? "Active. New requests use this version." : "Switched off: new requests cannot be started."}
      actions={
        <>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { const r = await setDefinitionActiveAction(workflowKey, !active); if (!r.ok) toast.error(r.error); else router.refresh(); })}>
            <Power /> {active ? "Switch off" : "Switch on"}
          </Button>
          <Button size="sm" disabled={!dirty || pending} onClick={publish}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Publish new version</Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="wf-name">Name</Label><Input id="wf-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="wf-desc">Description</Label><Input id="wf-desc" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      </div>
      <ol className="mt-5 space-y-4">
        {steps.map((s, i) => (
          <li key={i} className="rounded-xl border p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="grid size-6 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{i + 1}</span>
              <Input aria-label={`Step ${i + 1} name`} value={s.name} onChange={(e) => patch(i, { name: e.target.value })} className="max-w-sm" />
              <Input aria-label={`Step ${i + 1} key`} value={s.key} onChange={(e) => patch(i, { key: e.target.value.toLowerCase() })} className="max-w-40 font-mono text-xs" />
              <div className="ml-auto flex gap-1">
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Move down" disabled={i === steps.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove step" disabled={steps.length === 1} onClick={() => setSteps(steps.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor={`m${i}`}>Decision</Label>
                <select id={`m${i}`} className={field} value={s.mode} onChange={(e) => patch(i, { mode: e.target.value as "ANY" | "ALL" })}>
                  <option value="ANY">Any one approver</option>
                  <option value="ALL">All approvers (parallel)</option>
                </select>
              </div>
              <div className="space-y-1.5"><Label htmlFor={`sla${i}`}>SLA (hours)</Label><Input id={`sla${i}`} type="number" min={1} value={s.slaHours ?? ""} onChange={(e) => patch(i, { slaHours: e.target.value ? Number(e.target.value) : undefined })} /></div>
              <div className="space-y-1.5">
                <Label htmlFor={`esc${i}`}>Escalate to</Label>
                <select id={`esc${i}`} className={field} value={s.escalateToRole ?? ""} onChange={(e) => patch(i, { escalateToRole: e.target.value || undefined })}>
                  <option value="">No escalation</option>
                  {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div className="flex flex-col justify-end gap-1 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={s.allowReturn} onChange={(e) => patch(i, { allowReturn: e.target.checked })} /> Can return</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={s.allowDelegate} onChange={(e) => patch(i, { allowDelegate: e.target.checked })} /> Can delegate</label>
              </div>
            </div>
            <fieldset className="mt-3">
              <legend className="mb-1.5 text-sm font-medium">Approvers</legend>
              <ul className="space-y-2">
                {s.approvers.map((rule, r) => (
                  <li key={r} className="flex flex-wrap items-center gap-2">
                    {rule.type === "role" ? (
                      <>
                        <select aria-label="Role" className={`${field} max-w-64`} value={rule.role} onChange={(e) => patchRule(i, r, { ...rule, role: e.target.value })}>
                          {roles.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <select aria-label="Scope" className={`${field} max-w-64`} value={rule.scope} onChange={(e) => patchRule(i, r, { ...rule, scope: e.target.value as "subject_department" | "global" })}>
                          <option value="subject_department">covering the request&apos;s department</option>
                          <option value="global">anyone holding the role</option>
                        </select>
                      </>
                    ) : rule.type === "data_user" ? (
                      <span className="flex items-center gap-2 text-sm">User named in the request field <Input aria-label="Request field" className="max-w-48 font-mono text-xs" value={rule.field} onChange={(e) => patchRule(i, r, { type: "data_user", field: e.target.value })} /></span>
                    ) : (
                      <Input aria-label="User id" className="max-w-64 font-mono text-xs" value={rule.userId} onChange={(e) => patchRule(i, r, { type: "user", userId: e.target.value })} />
                    )}
                    <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove approver rule" disabled={s.approvers.length === 1} onClick={() => patch(i, { approvers: s.approvers.filter((_, j) => j !== r) })}><Trash2 /></Button>
                  </li>
                ))}
              </ul>
              <Button type="button" size="xs" variant="outline" className="mt-2" onClick={() => patch(i, { approvers: [...s.approvers, { type: "role", role: roles[0]?.value ?? "HOD", scope: "subject_department" }] })}><Plus /> Approver role</Button>
            </fieldset>
            <div className="mt-3 space-y-1.5">
              <Label htmlFor={`c${i}`}>Condition (optional)</Label>
              <Textarea id={`c${i}`} rows={2} className="font-mono text-xs" placeholder='{"field":"days","op":"gt","value":3}' value={s.conditionText} onChange={(e) => patch(i, { conditionText: e.target.value })} />
              <p className="text-xs text-muted-foreground">The step runs only when the condition holds for the request&apos;s data. Operators: eq, neq, gt, gte, lt, lte, in, notIn, exists; combine with {"{"}&quot;all&quot;: […]{"}"} or {"{"}&quot;any&quot;: […]{"}"}.</p>
            </div>
          </li>
        ))}
      </ol>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-4"
        onClick={() => setSteps([...steps, { key: `step_${steps.length + 1}`, name: "New step", approvers: [{ type: "role", role: roles[0]?.value ?? "HOD", scope: "subject_department" }], mode: "ANY", allowReturn: true, allowDelegate: true, conditionText: "" }])}
      >
        <Plus /> Add step
      </Button>
    </Section>
  );
}
