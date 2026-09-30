import { NextResponse, type NextRequest } from "next/server";
import { toCsv } from "@/lib/domain/csv";
import { getAuth } from "@/server/auth/current";
import { isAppError } from "@/server/errors";
import { assertRate } from "@/server/security/rate-limit";
import { exportStudents } from "@/server/services/students";

export const runtime = "nodejs";

/** CSV export of the full filtered student list (not just the visible page). Audited in the service. */
export async function GET(req: NextRequest) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  try {
    assertRate(`export:${ctx.user.id}`, 10, 60_000);
    const sp = req.nextUrl.searchParams;
    const rows = await exportStudents(ctx, {
      q: sp.get("q") ?? undefined, programId: sp.get("program") ?? undefined, batchId: sp.get("batch") ?? undefined, departmentId: sp.get("dept") ?? undefined,
      status: sp.get("status") ?? undefined, semester: sp.get("sem") ?? undefined, section: sp.get("section") ?? undefined,
    });
    const csv = toCsv(
      ["student_no", "admission_no", "registration_no", "first_name", "last_name", "email", "phone", "programme", "batch", "department", "semester", "section", "status", "admitted_on"],
      rows.map((s) => [s.studentNo, s.admissionNo, s.registrationNo, s.firstName, s.lastName, s.email, s.phone, s.program.code, s.batch.code, s.department.code, s.currentSemester, s.section, s.status, s.admittedOn.toISOString().slice(0, 10)]),
    );
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="students-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (isAppError(e)) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[students.export]", e);
    return NextResponse.json({ error: "The export failed." }, { status: 500 });
  }
}
