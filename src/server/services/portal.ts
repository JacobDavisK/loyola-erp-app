import "server-only";
import type { AuthContext } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, notFound } from "@/server/errors";
import { isSuperAdmin } from "@/server/auth/current";

export interface PortalSubject {
  student: { id: string; studentNo: string; firstName: string; lastName: string; status: string; currentSemester: number; programId: string; batchId: string; program: { code: string; name: string }; batch: { code: string } };
  isSelf: boolean;
  canAcademic: boolean;
  canFinance: boolean;
  wards: { id: string; name: string }[];
  /** The Super Admin viewing a student's portal */
  viewAs?: boolean;
}

/**
 * Whose record the self-service portal shows. Students see themselves. Guardians choose among their
 * linked wards and see only what the institution allowed on the guardian record. The id always comes
 * from the signed-in account's own links, never from an unchecked parameter.
 */
export async function portalSubject(ctx: AuthContext, requested?: string): Promise<PortalSubject> {
  const include = { program: { select: { code: true, name: true } }, batch: { select: { code: true } } } as const;
  if (ctx.subject.studentId) {
    const student = await db.student.findFirstOrThrow({ where: { id: ctx.subject.studentId, deletedAt: null }, include });
    return { student, isSelf: true, canAcademic: true, canFinance: true, wards: [] };
  }
  // The Super Admin can open any student's portal (as the student sees it) by student id or number.
  if (isSuperAdmin(ctx)) {
    const student = requested
      ? await db.student.findFirst({ where: { deletedAt: null, OR: [{ id: requested }, { studentNo: requested.toUpperCase() }] }, include })
      : await db.student.findFirst({ where: { deletedAt: null, status: "ACTIVE" }, orderBy: { studentNo: "asc" }, include });
    if (!student) throw notFound("Student");
    return { student, isSelf: false, canAcademic: true, canFinance: true, wards: [], viewAs: true };
  }
  if (!ctx.subject.wardStudentIds.length) throw forbidden("Your account is not linked to a student record. Contact the institution office.");
  const links = await db.guardian.findMany({
    where: { userId: ctx.user.id, studentId: { in: ctx.subject.wardStudentIds }, student: { deletedAt: null } },
    include: { student: { include } },
    orderBy: { student: { firstName: "asc" } },
  });
  if (!links.length) throw forbidden("Your account is not linked to a student record.");
  const link = links.find((l) => l.studentId === requested) ?? links[0];
  return {
    student: link.student,
    isSelf: false,
    canAcademic: link.canViewAcademic,
    canFinance: link.canViewFinance,
    wards: links.map((l) => ({ id: l.studentId, name: `${l.student.firstName} ${l.student.lastName}` })),
  };
}
