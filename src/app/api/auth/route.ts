import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authenticate } from "@/server/auth/login";
import { destroyCurrentSession } from "@/server/auth/session";
import { getAuth } from "@/server/auth/current";
import { isAppError } from "@/server/errors";
import { audit } from "@/server/services/audit";

/** GET /api/auth — current session identity (no secrets). */
export async function GET() {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ authenticated: false }, { status: 401 });
  return NextResponse.json({ authenticated: true, user: { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email, employeeId: ctx.user.employeeId }, roles: ctx.roles.map((r) => ({ key: r.key, department: r.departmentName })), permissions: [...ctx.grants.keys()] });
}

/** POST /api/auth { identifier, password, remember } — sets the HttpOnly session cookie. */
export async function POST(req: NextRequest) {
  try {
    const v = z.object({ identifier: z.string().min(1).max(200), password: z.string().min(1).max(200), remember: z.boolean().default(false) }).parse(await req.json());
    const out = await authenticate(v.identifier, v.password, v.remember);
    if (out.status === "invalid") return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
    if (out.status === "locked") return NextResponse.json({ error: `Account locked. Try again in ${out.minutes} minute(s).` }, { status: 423 });
    return NextResponse.json({ status: out.status === "mfa" ? "mfa_required" : "ok" });
  } catch (e) {
    if (isAppError(e)) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof z.ZodError) return NextResponse.json({ error: "Invalid request." }, { status: 422 });
    return NextResponse.json({ error: "Sign-in failed." }, { status: 500 });
  }
}

/** DELETE /api/auth — sign out. */
export async function DELETE() {
  const ctx = await getAuth();
  const userId = await destroyCurrentSession();
  if (userId) await audit({ actorId: userId, actorName: ctx?.user.name, action: "auth.logout", resourceType: "user", resourceId: userId, summary: "Signed out (API)" });
  return NextResponse.json({ status: "signed_out" });
}
