import "server-only";
import { z } from "zod";
import type { ApiScope } from "@/lib/domain/integrations";
import type { AuthContext } from "@/server/auth/current";
import { isAppError } from "@/server/errors";
import { getStudent, listCourses, listInvoices, listStudents, me, operationsSnapshot, selfSummary, upcomingClasses, upcomingEvents } from "@/server/services/open-api";

/**
 * Model Context Protocol server (Streamable HTTP transport, JSON responses) so AI assistants such as Claude
 * can work with the ERP. Read-only: every tool calls the same scoped functions as the REST API, as the
 * token's owner, and is offered only when the token has the matching scope.
 */

export const MCP_PROTOCOL = "2025-06-18";

interface Tool {
  name: string;
  description: string;
  scope: ApiScope;
  input: z.ZodType;
  inputSchema: Record<string, unknown>;
  run: (ctx: AuthContext, args: never) => Promise<unknown>;
}

const str = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const paging = { limit: { type: "integer", minimum: 1, maximum: 100, description: "Rows to return (default 25)" }, offset: { type: "integer", minimum: 0, description: "Rows to skip" } };
const pg = (a: { limit?: number; offset?: number }) => ({ take: Math.min(100, a.limit ?? 25), skip: a.offset ?? 0 });

const TOOLS: Tool[] = [
  { name: "whoami", description: "The signed-in person: name, roles, department, linked student records.", scope: "profile:read", input: z.object({}), inputSchema: obj(), run: (ctx) => me(ctx) },
  {
    name: "my_summary", description: "Attendance (per course and overall, against the minimum), published results with CGPA, and the fee balance — for the student, or for a guardian's ward.", scope: "self:read",
    input: z.object({ student_id: z.string().optional() }), inputSchema: obj({ student_id: str("Guardians with several wards: the ward's student id") }),
    run: (ctx, a: { student_id?: string }) => selfSummary(ctx, a.student_id),
  },
  {
    name: "my_classes", description: "Classes in the coming days (as a student, or as the teacher), with times and rooms.", scope: "self:read",
    input: z.object({ days: z.number().int().min(1).max(31).optional() }), inputSchema: obj({ days: { type: "integer", minimum: 1, maximum: 31, description: "Days ahead (default 7)" } }),
    run: (ctx, a: { days?: number }) => upcomingClasses(ctx, a.days ?? 7),
  },
  {
    name: "search_students", description: "Find students the user may see, by name, number or e-mail.", scope: "students:read",
    input: z.object({ query: z.string().max(80).optional(), status: z.string().max(20).optional(), limit: z.number().int().optional(), offset: z.number().int().optional() }),
    inputSchema: obj({ query: str("Name, student number or e-mail"), status: str("ACTIVE, GRADUATED, ON_LEAVE …"), ...paging }),
    run: (ctx, a: { query?: string; status?: string; limit?: number; offset?: number }) => listStudents(ctx, { q: a.query, status: a.status, ...pg(a) }),
  },
  {
    name: "get_student", description: "One student's record (programme, department, semester, status).", scope: "students:read",
    input: z.object({ student_id: z.string() }), inputSchema: obj({ student_id: str("Student id from search_students") }, ["student_id"]),
    run: (ctx, a: { student_id: string }) => getStudent(ctx, a.student_id),
  },
  {
    name: "list_courses", description: "Courses in the curriculum, by code or title.", scope: "academics:read",
    input: z.object({ query: z.string().max(80).optional(), limit: z.number().int().optional(), offset: z.number().int().optional() }), inputSchema: obj({ query: str("Code or title"), ...paging }),
    run: (ctx, a: { query?: string; limit?: number; offset?: number }) => listCourses(ctx, { q: a.query, ...pg(a) }),
  },
  {
    name: "list_invoices", description: "Fee invoices the user may see, newest first.", scope: "finance:read",
    input: z.object({ status: z.string().max(20).optional(), student_id: z.string().optional(), limit: z.number().int().optional(), offset: z.number().int().optional() }),
    inputSchema: obj({ status: str("ISSUED, PARTIALLY_PAID, PAID or CANCELLED"), student_id: str("Only this student's invoices"), ...paging }),
    run: (ctx, a: { status?: string; student_id?: string; limit?: number; offset?: number }) => listInvoices(ctx, { status: a.status, studentId: a.student_id, ...pg(a) }),
  },
  { name: "upcoming_events", description: "Published campus events that have not ended.", scope: "events:read", input: z.object({}), inputSchema: obj(), run: () => upcomingEvents() },
  { name: "operations_snapshot", description: "Stock levels with reorder warnings, asset counts by status, and upcoming room bookings — whatever the user manages.", scope: "operations:read", input: z.object({}), inputSchema: obj(), run: (ctx) => operationsSnapshot(ctx) },
];

type RpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };
const ok = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const fail = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** Handle one JSON-RPC message; returns null for notifications. */
export async function handleMcp(msg: RpcRequest, ctx: AuthContext, scopes: ApiScope[]): Promise<object | null> {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(null, -32600, "Invalid request");
  const isNotification = msg.id === undefined;
  const tools = TOOLS.filter((t) => scopes.includes(t.scope));
  switch (msg.method) {
    case "initialize":
      return ok(msg.id, {
        protocolVersion: MCP_PROTOCOL, capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "university-erp", title: "University of the World ERP", version: "1.0.0" },
        instructions: `You are connected to the university ERP as ${ctx.user.name}. All tools are read-only and show only what this person may see. Treat student data as confidential.`,
      });
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: true, openWorldHint: false } })) });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const tool = tools.find((t) => t.name === name);
      if (!tool) return fail(msg.id, -32602, TOOLS.some((t) => t.name === name) ? `The token lacks the scope for ${name}.` : `Unknown tool ${name}`);
      const parsed = tool.input.safeParse(msg.params?.arguments ?? {});
      if (!parsed.success) return ok(msg.id, { content: [{ type: "text", text: `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` }], isError: true });
      try {
        const data = await tool.run(ctx, parsed.data as never);
        return ok(msg.id, { content: [{ type: "text", text: JSON.stringify(data, null, 1) }], structuredContent: Array.isArray(data) ? { items: data } : data, isError: false });
      } catch (e) {
        const message = isAppError(e) ? e.message : "The request could not be completed.";
        if (!isAppError(e)) console.error("[mcp]", e);
        return ok(msg.id, { content: [{ type: "text", text: message }], isError: true });
      }
    }
    default:
      if (isNotification) return null;
      return fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}
