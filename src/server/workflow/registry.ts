import "server-only";
import type { WorkflowInstance } from "@/generated/prisma/client";
import type { WorkflowStep } from "@/lib/domain/workflow-engine";
import type { Tx } from "@/server/db";

/**
 * Module integration points for the workflow engine. A module registers, per workflow key:
 *  - the default definition (seeded as version 1; administrators can publish new versions), and
 *  - completion hooks that apply the outcome to the module's own records, inside the same transaction.
 */
export interface WorkflowModule {
  key: string;
  name: string;
  module: string;
  description: string;
  defaultSteps: WorkflowStep[];
  /** Link to the record under approval (shown in the approval centre). */
  href?: (instance: Pick<WorkflowInstance, "resourceType" | "resourceId" | "data">) => string | null;
  /** Label/value pairs shown to approvers. Without it the raw request data is listed. */
  details?: (data: unknown) => [label: string, value: string][];
  onApproved?: (tx: Tx, instance: WorkflowInstance) => Promise<void>;
  onRejected?: (tx: Tx, instance: WorkflowInstance) => Promise<void>;
  onReturned?: (tx: Tx, instance: WorkflowInstance) => Promise<void>;
  onCancelled?: (tx: Tx, instance: WorkflowInstance) => Promise<void>;
}

const modules = new Map<string, WorkflowModule>();

export function registerWorkflow(m: WorkflowModule) {
  modules.set(m.key, m);
}

export function workflowModule(key: string): WorkflowModule | undefined {
  return modules.get(key);
}

export function registeredWorkflows(): WorkflowModule[] {
  return [...modules.values()].sort((a, b) => a.module.localeCompare(b.module) || a.name.localeCompare(b.name));
}
