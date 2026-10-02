import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, SYSTEM_ROLES } from "@/lib/domain/permissions";
import type { AuthContext } from "@/server/auth/current";
import { can, hasGlobal, scopeOf } from "@/server/auth/current";
import { paperCapabilities } from "@/server/auth/access";

function ctxFor(roleKey: keyof typeof SYSTEM_ROLES, dept: string | null = null, userId = "u1"): AuthContext {
  const role = SYSTEM_ROLES[roleKey];
  const grants = new Map<never, Set<string> | null>();
  for (const p of role.permissions) grants.set(p as never, role.global ? null : new Set(dept ? [dept] : []));
  return {
    sessionId: "s",
    user: { id: userId, name: "Test", email: "t@x", employeeId: "E1", designation: null, departmentId: dept, departmentName: null, avatarAssetId: null, mfaEnabled: false, mustChangePassword: false, userType: "STAFF", locale: "en" },
    roles: [{ key: roleKey, name: role.name, rank: role.rank, isGlobal: role.global, departmentId: dept, departmentName: null }],
    primaryRole: { key: roleKey, name: role.name, rank: role.rank, isGlobal: role.global, departmentId: dept, departmentName: null },
    subject: { studentId: null, wardStudentIds: [], employeeId: null },
    grants,
  };
}

const paper = (p: Partial<Parameters<typeof paperCapabilities>[1]> = {}) => ({
  id: "p1",
  status: "DRAFT" as const,
  setterId: "setter",
  assignment: { backupSetterId: null },
  examination: { moderatorId: "mod", scrutinizerId: "scr", course: { departmentId: "CS" } },
  ...p,
});

describe("permission catalogue", () => {
  it("every role only references known permissions", () => {
    for (const r of Object.values(SYSTEM_ROLES)) for (const p of r.permissions) expect(ALL_PERMISSIONS).toContain(p);
  });

  it("gives the Super Admin every permission of every role", () => {
    const admin = SYSTEM_ROLES.SUPER_ADMIN.permissions;
    expect([...admin].sort()).toEqual([...ALL_PERMISSIONS].sort());
    for (const r of Object.values(SYSTEM_ROLES)) for (const p of r.permissions) expect(admin).toContain(p);
  });

  it("keeps the IT administrator away from confidential content", () => {
    const it = SYSTEM_ROLES.IT_ADMIN.permissions;
    expect(it).not.toContain("paper.view.scope");
    expect(it).not.toContain("student.view");
  });

  it("auditors are read-only", () => {
    const perms = SYSTEM_ROLES.AUDITOR.permissions;
    expect(perms.every((p) => p.endsWith(".view") || p.endsWith(".report"))).toBe(true);
  });

  it("setters cannot approve or lock", () => {
    const c = ctxFor("SETTER", "CS");
    expect(can(c, "paper.approve")).toBe(false);
    expect(can(c, "paper.lock")).toBe(false);
  });
});

describe("scoped permissions", () => {
  it("global roles are unrestricted", () => {
    const c = ctxFor("EXAM_CONTROLLER");
    expect(hasGlobal(c, "paper.view.scope")).toBe(true);
    expect(can(c, "paper.view.scope", "ANY-DEPT")).toBe(true);
    expect(scopeOf(c, "exam.view")).toBeNull();
  });

  it("departmental roles are confined to their department", () => {
    const hod = ctxFor("HOD", "CS");
    expect(can(hod, "paper.view.scope", "CS")).toBe(true);
    expect(can(hod, "paper.view.scope", "COM")).toBe(false);
    expect(scopeOf(hod, "paper.view.scope")).toEqual(["CS"]);
  });
});

describe("object-level paper capabilities", () => {
  it("setter can edit only their own draft", () => {
    const setter = ctxFor("SETTER", "CS", "setter");
    expect(paperCapabilities(setter, paper()).editContent).toBe(true);
    expect(paperCapabilities(setter, paper({ status: "SUBMITTED" })).editContent).toBe(false);
    expect(paperCapabilities(setter, paper({ status: "LOCKED" })).editContent).toBe(false);
    const other = ctxFor("SETTER", "CS", "someone-else");
    expect(paperCapabilities(other, paper()).view).toBe(false);
  });

  it("backup setter shares the owner's access", () => {
    const backup = ctxFor("SETTER", "CS", "backup");
    expect(paperCapabilities(backup, paper({ assignment: { backupSetterId: "backup" } })).isOwner).toBe(true);
  });

  it("moderator cannot see drafts, only submitted papers they moderate", () => {
    const mod = ctxFor("MODERATOR", "CS", "mod");
    expect(paperCapabilities(mod, paper({ status: "DRAFT" })).view).toBe(false);
    expect(paperCapabilities(mod, paper({ status: "SUBMITTED" })).view).toBe(true);
    expect(paperCapabilities(mod, paper({ status: "SUBMITTED" })).moderate).toBe(true);
    const otherMod = ctxFor("MODERATOR", "CS", "mod-2");
    expect(paperCapabilities(otherMod, paper({ status: "SUBMITTED" })).view).toBe(false);
  });

  it("scrutiny officer sees papers only from the scrutiny stage", () => {
    const scr = ctxFor("SCRUTINY_OFFICER", null, "scr");
    expect(paperCapabilities(scr, paper({ status: "UNDER_MODERATION" })).view).toBe(false);
    expect(paperCapabilities(scr, paper({ status: "UNDER_SCRUTINY" })).scrutinize).toBe(true);
  });

  it("HOD cannot see another department's papers (no cross-department access)", () => {
    const hod = ctxFor("HOD", "COM", "hod");
    expect(paperCapabilities(hod, paper()).view).toBe(false);
  });

  it("final downloads require the export.final permission", () => {
    const setter = ctxFor("SETTER", "CS", "setter");
    expect(paperCapabilities(setter, paper({ status: "LOCKED" })).exportFinal).toBe(false);
    expect(paperCapabilities(ctxFor("EXAM_CONTROLLER"), paper({ status: "LOCKED" })).exportFinal).toBe(true);
  });
});
