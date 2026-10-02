import { NextResponse } from "next/server";
import { API_SCOPES } from "@/lib/domain/integrations";
import { env } from "@/server/env";

/** OpenAPI 3.1 description of the public API. Public: it describes the interface, not any data. */
export function GET() {
  const list = (scope: string, summary: string, params: { name: string; description: string }[] = []) => ({
    get: {
      summary, security: [{ token: [scope] }], "x-scope": scope,
      parameters: params.map((p) => ({ name: p.name, in: "query", required: false, description: p.description, schema: { type: "string" } })),
      responses: { 200: { description: "`{ data: … }`" }, 401: { description: "Missing, invalid, expired or revoked token" }, 403: { description: "The token lacks the scope, or its owner lacks the permission" }, 429: { description: "More than 120 requests a minute" } },
    },
  });
  const paging = [{ name: "limit", description: "1–100, default 25" }, { name: "offset", description: "Rows to skip" }];
  const doc = {
    openapi: "3.1.0",
    info: { title: "University of the World ERP API", version: "1.0.0", description: `Read access for other systems and AI tools. Create a personal access token under Profile → API tokens and send it as \`Authorization: Bearer ecp_…\`. A token acts as its owner, limited to its scopes:\n\n${Object.entries(API_SCOPES).map(([k, v]) => `- \`${k}\`: ${v}`).join("\n")}` },
    servers: [{ url: `${env.APP_URL}/api/v1` }],
    components: { securitySchemes: { token: { type: "http", scheme: "bearer", description: "Personal access token (ecp_…)" } } },
    paths: {
      "/me": list("profile:read", "Who the token belongs to"),
      "/me/summary": list("self:read", "Own (or a ward's) attendance, results and fee balance", [{ name: "student", description: "Guardians: the ward's student id" }]),
      "/me/classes": list("self:read", "Upcoming classes", [{ name: "days", description: "1–31, default 7" }]),
      "/students": list("students:read", "Students the owner may see", [{ name: "q", description: "Name, number or e-mail" }, { name: "department", description: "Department id" }, { name: "status", description: "ACTIVE, GRADUATED, …" }, ...paging]),
      "/students/{id}": { get: { ...list("students:read", "One student").get, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }] } },
      "/courses": list("academics:read", "Courses", [{ name: "q", description: "Code or title" }, ...paging]),
      "/invoices": list("finance:read", "Fee invoices the owner may see", [{ name: "status", description: "ISSUED, PARTIALLY_PAID, PAID, CANCELLED" }, { name: "student", description: "Student id" }, ...paging]),
      "/events": list("events:read", "Upcoming campus events"),
      "/operations": list("operations:read", "Stock levels, asset counts and room bookings the owner manages"),
    },
    "x-webhooks": "Webhooks are configured by administrators under Admin → Integrations. Each POST carries X-ERP-Event, X-ERP-Delivery and X-ERP-Signature: t=<unix>,v1=<hex HMAC-SHA256 of \"<t>.<body>\" with the endpoint secret>.",
  };
  return NextResponse.json(doc, { headers: { "Cache-Control": "public, max-age=300" } });
}
