/**
 * Generic approval workflow rules (pure). Definitions are data, validated here; the server layer
 * (src/server/services/workflow.ts) resolves approvers, persists tasks and runs completion handlers.
 *
 * A definition is an ordered list of steps. Each step:
 *  - names who approves (roles scoped to the request's department, named users, or the request's line head)
 *  - runs in ANY mode (first decision wins) or ALL mode (parallel approval; every approver must approve)
 *  - may carry a condition on the request data; a step whose condition is false is skipped
 *  - may have an SLA (hours) and an escalation role
 */
import { z } from "zod";

export type ConditionOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "notIn" | "exists";

export type Condition =
  | { field: string; op: ConditionOp; value?: unknown }
  | { all: Condition[] }
  | { any: Condition[] };

const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({
      field: z.string().regex(/^[A-Za-z_][\w.]*$/, "Use a field path such as days or amount"),
      op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "notIn", "exists"]),
      value: z.unknown().optional(),
    }),
    z.object({ all: z.array(conditionSchema).min(1) }),
    z.object({ any: z.array(conditionSchema).min(1) }),
  ]),
);

export const approverRuleSchema = z.discriminatedUnion("type", [
  /** Holders of a role whose grant covers the request's department (or global holders). */
  z.object({ type: z.literal("role"), role: z.string().min(2), scope: z.enum(["subject_department", "global"]).default("subject_department") }),
  /** A named user. */
  z.object({ type: z.literal("user"), userId: z.string().min(1) }),
  /** The user whose id is stored in a field of the request data (e.g. the requester's reporting manager). */
  z.object({ type: z.literal("data_user"), field: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/) }),
]);
export type ApproverRule = z.infer<typeof approverRuleSchema>;

export const stepSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/, "lower_snake_case"),
  name: z.string().trim().min(2).max(80),
  approvers: z.array(approverRuleSchema).min(1, "Every step needs at least one approver rule"),
  mode: z.enum(["ANY", "ALL"]).default("ANY"),
  condition: conditionSchema.optional(),
  slaHours: z.number().int().min(1).max(24 * 60).optional(),
  escalateToRole: z.string().min(2).optional(),
  allowReturn: z.boolean().default(true),
  allowDelegate: z.boolean().default(true),
});
export type WorkflowStep = z.infer<typeof stepSchema>;

export const stepsSchema = z
  .array(stepSchema)
  .min(1, "A workflow needs at least one step")
  .max(12)
  .refine((s) => new Set(s.map((x) => x.key)).size === s.length, "Step keys must be unique");

export function parseSteps(raw: unknown): WorkflowStep[] {
  return stepsSchema.parse(raw);
}

function getPath(data: unknown, path: string): unknown {
  let cur: unknown = data;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)) ? Number(v) : NaN);

export function evaluateCondition(cond: Condition | undefined, data: unknown): boolean {
  if (!cond) return true;
  if ("all" in cond) return cond.all.every((c) => evaluateCondition(c, data));
  if ("any" in cond) return cond.any.some((c) => evaluateCondition(c, data));
  const actual = getPath(data, cond.field);
  switch (cond.op) {
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "eq":
      return actual === cond.value;
    case "neq":
      return actual !== cond.value;
    case "in":
      return Array.isArray(cond.value) && cond.value.includes(actual);
    case "notIn":
      return Array.isArray(cond.value) && !cond.value.includes(actual);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = num(actual);
      const b = num(cond.value);
      if (isNaN(a) || isNaN(b)) return false;
      return cond.op === "gt" ? a > b : cond.op === "gte" ? a >= b : cond.op === "lt" ? a < b : a <= b;
    }
  }
}

/** Index of the first step at or after `from` whose condition holds, or null when the workflow is finished. */
export function nextApplicableStep(steps: WorkflowStep[], from: number, data: unknown): number | null {
  for (let i = from; i < steps.length; i++) if (evaluateCondition(steps[i].condition, data)) return i;
  return null;
}

export type TaskState = "PENDING" | "APPROVED" | "REJECTED" | "RETURNED" | "SKIPPED" | "CANCELLED";
export type StepOutcome = "pending" | "approved" | "rejected" | "returned";

/**
 * Outcome of a step from the states of its (non-cancelled) tasks.
 * ANY: the first decision decides. ALL: any rejection/return decides immediately; approval needs everyone.
 */
export function stepOutcome(mode: WorkflowStep["mode"], states: TaskState[]): StepOutcome {
  const live = states.filter((s) => s !== "CANCELLED" && s !== "SKIPPED");
  if (!live.length) return "pending";
  if (live.includes("REJECTED")) return "rejected";
  if (live.includes("RETURNED")) return "returned";
  if (mode === "ANY") return live.includes("APPROVED") ? "approved" : "pending";
  return live.every((s) => s === "APPROVED") ? "approved" : "pending";
}

export function dueDate(step: WorkflowStep, from: Date): Date | null {
  return step.slaHours ? new Date(from.getTime() + step.slaHours * 3_600_000) : null;
}

/** Human-readable description of a condition for the admin screens. */
export function describeCondition(cond: Condition | undefined): string {
  if (!cond) return "Always";
  if ("all" in cond) return cond.all.map(describeCondition).join(" and ");
  if ("any" in cond) return `(${cond.any.map(describeCondition).join(" or ")})`;
  const op = { eq: "=", neq: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤", in: "is one of", notIn: "is not one of", exists: "is present" }[cond.op];
  return cond.op === "exists" ? `${cond.field} ${op}` : `${cond.field} ${op} ${Array.isArray(cond.value) ? cond.value.join(", ") : String(cond.value)}`;
}
