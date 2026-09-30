import "server-only";
import type { PaperStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { SETTER_EDITABLE } from "@/lib/domain/workflow";
import { type AuthContext, can, isSuperAdmin, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, notFound } from "@/server/errors";
import { getSetting } from "@/server/services/settings";

/** True when one of the user's roles requires MFA and the user has not enrolled. */
export async function mfaRequiredButMissing(ctx: AuthContext): Promise<boolean> {
  if (ctx.user.mfaEnabled) return false;
  const { requireMfaForRoles } = await getSetting("security");
  return ctx.roles.some((r) => requireMfaForRoles.includes(r.key));
}

/**
 * Object-level authorisation. Every query for examination data goes through one of these
 * where-builders so a user can never read records outside their scope (IDOR / cross-department).
 */

const MODERATOR_VISIBLE: PaperStatus[] = [
  "SUBMITTED", "UNDER_MODERATION", "REVISION_REQUIRED", "RESUBMITTED", "UNDER_SCRUTINY",
  "AWAITING_APPROVAL", "APPROVED", "LOCKED", "REJECTED",
];
const SCRUTINY_VISIBLE: PaperStatus[] = ["UNDER_SCRUTINY", "AWAITING_APPROVAL", "APPROVED", "LOCKED"];
const APPROVER_VISIBLE: PaperStatus[] = ["AWAITING_APPROVAL", "APPROVED", "LOCKED", "RELEASED", "ARCHIVED", "REJECTED"];

export function examinationWhere(ctx: AuthContext): Prisma.ExaminationWhereInput {
  const scope = scopeOf(ctx, "exam.view");
  if (scope === null) return {};
  const or: Prisma.ExaminationWhereInput[] = [
    { assignments: { some: { OR: [{ setterId: ctx.user.id }, { backupSetterId: ctx.user.id }], status: { not: "CANCELLED" } } } },
    { moderatorId: ctx.user.id },
    { scrutinizerId: ctx.user.id },
  ];
  if (scope.length) or.push({ course: { departmentId: { in: scope } } });
  return { OR: or };
}

export function paperWhere(ctx: AuthContext): Prisma.QuestionPaperWhereInput {
  const scope = scopeOf(ctx, "paper.view.scope");
  const base: Prisma.QuestionPaperWhereInput = { deletedAt: null };
  if (scope === null) return base;
  const or: Prisma.QuestionPaperWhereInput[] = [
    { setterId: ctx.user.id },
    { assignment: { backupSetterId: ctx.user.id } },
  ];
  if (can(ctx, "moderation.perform")) or.push({ examination: { moderatorId: ctx.user.id }, status: { in: MODERATOR_VISIBLE } });
  if (can(ctx, "scrutiny.perform")) or.push({ examination: { scrutinizerId: ctx.user.id }, status: { in: SCRUTINY_VISIBLE } });
  if (can(ctx, "paper.approve") && scopeOf(ctx, "paper.approve") === null) or.push({ status: { in: APPROVER_VISIBLE } });
  if (scope.length) or.push({ examination: { course: { departmentId: { in: scope } } } });
  return { ...base, OR: or };
}

export function questionWhere(ctx: AuthContext): Prisma.QuestionWhereInput {
  const scope = scopeOf(ctx, "question.view");
  const base: Prisma.QuestionWhereInput = { deletedAt: null };
  if (scope === null) return base;
  const activeAssignment = {
    examinations: {
      some: {
        OR: [
          { assignments: { some: { OR: [{ setterId: ctx.user.id }, { backupSetterId: ctx.user.id }], status: { notIn: ["CANCELLED", "DECLINED"] as const } } } },
          { moderatorId: ctx.user.id },
        ],
      },
    },
  } satisfies Prisma.CourseWhereInput;
  const or: Prisma.QuestionWhereInput[] = [{ authorId: ctx.user.id }, { course: activeAssignment }];
  if (scope.length) or.push({ course: { departmentId: { in: scope } } });
  return { ...base, OR: or };
}

/** Courses for which the user may author questions. */
export function authorableCourseWhere(ctx: AuthContext): Prisma.CourseWhereInput {
  const scope = scopeOf(ctx, "question.create");
  if (scope === null) return { deletedAt: null };
  const or: Prisma.CourseWhereInput[] = [
    { examinations: { some: { assignments: { some: { setterId: ctx.user.id, status: { notIn: ["CANCELLED", "DECLINED"] } } } } } },
  ];
  if (scope.length) or.push({ departmentId: { in: scope } });
  return { deletedAt: null, OR: or };
}

export interface PaperCapabilities {
  view: boolean;
  isOwner: boolean;
  editContent: boolean;
  moderate: boolean;
  scrutinize: boolean;
  approve: boolean;
  exportDraft: boolean;
  exportFinal: boolean;
}

type PaperForAccess = {
  id: string;
  status: PaperStatus;
  setterId: string;
  assignment: { backupSetterId: string | null } | null;
  examination: { moderatorId: string | null; scrutinizerId: string | null; course: { departmentId: string } };
};

export function paperCapabilities(ctx: AuthContext, p: PaperForAccess): PaperCapabilities {
  const uid = ctx.user.id;
  const dept = p.examination.course.departmentId;
  const superAdmin = isSuperAdmin(ctx);
  const isOwner = p.setterId === uid || p.assignment?.backupSetterId === uid || superAdmin;
  const isModerator = (p.examination.moderatorId === uid || superAdmin) && can(ctx, "moderation.perform");
  const isScrutinizer = (p.examination.scrutinizerId === uid || superAdmin) && can(ctx, "scrutiny.perform");
  const approverGlobal = can(ctx, "paper.approve") && scopeOf(ctx, "paper.approve") === null;
  const view =
    isOwner ||
    can(ctx, "paper.view.scope", dept) ||
    (isModerator && MODERATOR_VISIBLE.includes(p.status)) ||
    (isScrutinizer && SCRUTINY_VISIBLE.includes(p.status)) ||
    (approverGlobal && APPROVER_VISIBLE.includes(p.status));
  return {
    view,
    isOwner,
    editContent: isOwner && can(ctx, "paper.edit.own") && SETTER_EDITABLE.includes(p.status),
    moderate: isModerator,
    scrutinize: isScrutinizer,
    approve: can(ctx, "paper.approve", dept),
    exportDraft: view && can(ctx, "paper.export.draft"),
    exportFinal: view && can(ctx, "paper.export.final", dept),
  };
}

export const paperAccessInclude = {
  assignment: { select: { backupSetterId: true } },
  examination: { select: { moderatorId: true, scrutinizerId: true, course: { select: { departmentId: true } } } },
} as const;

/** Load a paper and assert the caller may view it. Unauthorised and missing look identical (no enumeration). */
export async function loadPaperFor(ctx: AuthContext, paperId: string) {
  if (await mfaRequiredButMissing(ctx)) throw forbidden("Your role requires two-step verification before you can open examination papers. Set it up under Profile & security.");
  const paper = await db.questionPaper.findFirst({ where: { id: paperId, deletedAt: null }, include: paperAccessInclude });
  if (!paper) throw notFound("Question paper");
  const caps = paperCapabilities(ctx, paper);
  if (!caps.view) throw notFound("Question paper");
  return { paper, caps };
}

export function assertCap(ok: boolean, msg?: string) {
  if (!ok) throw forbidden(msg);
}

// ───────────────────────── Students & academic operations ─────────────────────────

const NONE = "__no_access__";

/**
 * Students the caller may see: in-scope departments (student.view), students registered in classes
 * the caller teaches, and — for self-service accounts — their own record or their wards.
 */
export function studentWhere(ctx: AuthContext): Prisma.StudentWhereInput {
  const base: Prisma.StudentWhereInput = { deletedAt: null };
  const scope = scopeOf(ctx, "student.view");
  if (scope === null) return base;
  const or: Prisma.StudentWhereInput[] = [];
  if (ctx.subject.studentId) or.push({ id: ctx.subject.studentId });
  if (ctx.subject.wardStudentIds.length) or.push({ id: { in: ctx.subject.wardStudentIds } });
  if (scope.length) or.push({ departmentId: { in: scope } });
  if (can(ctx, "attendance.take")) {
    or.push({ registrations: { some: { status: { in: ["REGISTERED", "COMPLETED"] }, offering: { instructors: { some: { userId: ctx.user.id } } } } } });
  }
  return { ...base, OR: or.length ? or : [{ id: NONE }] };
}

/** Load one student the caller may see; unauthorised and missing are indistinguishable. */
export async function loadStudentFor(ctx: AuthContext, id: string) {
  const s = await db.student.findFirst({ where: { AND: [{ id }, studentWhere(ctx)] } });
  if (!s) throw notFound("Student");
  return s;
}

/** Staff-side permission on a student's department (create/update/status/export…). */
export function assertStudentPerm(ctx: AuthContext, perm: "student.create" | "student.update" | "student.status" | "student.export" | "student.delete", departmentId: string) {
  if (!can(ctx, perm, departmentId)) throw forbidden();
}

/** Course offerings visible to the caller: in-scope departments, classes they teach, or classes they attend. */
export function offeringWhere(ctx: AuthContext): Prisma.CourseOfferingWhereInput {
  const scope = scopeOf(ctx, "academic.view");
  if (scope === null) return {};
  const or: Prisma.CourseOfferingWhereInput[] = [{ instructors: { some: { userId: ctx.user.id } } }];
  if (scope.length) or.push({ course: { departmentId: { in: scope } } });
  const self = [ctx.subject.studentId, ...ctx.subject.wardStudentIds].filter((x): x is string => !!x);
  if (self.length) or.push({ registrations: { some: { studentId: { in: self } } } });
  return { OR: or };
}

/** Whether the caller may record attendance for an offering. */
export function canTakeAttendance(ctx: AuthContext, offering: { courseDepartmentId: string; instructorIds: string[] }): boolean {
  return (can(ctx, "attendance.take") && offering.instructorIds.includes(ctx.user.id)) || can(ctx, "attendance.manage", offering.courseDepartmentId);
}
