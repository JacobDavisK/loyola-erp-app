import "server-only";
import { audit } from "@/server/services/audit";
import { notify } from "@/server/services/notifications";
import { registerWorkflow } from "@/server/workflow/registry";

export interface AccessRequestData {
  userId: string;
  userName: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  scopeType: "global" | "department" | "unit" | "campus";
  departmentId: string | null;
  academicUnitId: string | null;
  campusId: string | null;
  scopeLabel: string;
  validUntil: string | null;
  reason: string;
  /** true when the request is for a departmental role — drives the HoD step condition */
  departmentScoped: boolean;
}

registerWorkflow({
  key: "access.request",
  name: "Access request",
  module: "Identity & access",
  description: "A staff member asks for an additional role. The grant is created automatically on approval and can expire.",
  defaultSteps: [
    {
      key: "hod",
      name: "Head of department review",
      approvers: [{ type: "role", role: "HOD", scope: "subject_department" }],
      mode: "ANY",
      condition: { field: "departmentScoped", op: "eq", value: true },
      slaHours: 48,
      allowReturn: true,
      allowDelegate: true,
    },
    {
      key: "security",
      name: "Security approval",
      approvers: [
        { type: "role", role: "SUPER_ADMIN", scope: "global" },
        { type: "role", role: "IT_ADMIN", scope: "global" },
      ],
      mode: "ANY",
      slaHours: 72,
      allowReturn: true,
      allowDelegate: false,
    },
  ],
  details: (raw) => {
    const d = raw as AccessRequestData;
    return [
      ["Person", d.userName],
      ["Role requested", d.roleName],
      ["Scope", d.scopeLabel],
      ["Access until", d.validUntil ? d.validUntil.slice(0, 10) : "No expiry"],
      ["Reason", d.reason],
    ];
  },
  href: (i) => `/admin/users/${(i.data as unknown as AccessRequestData).userId}`,
  async onApproved(tx, instance) {
    const d = instance.data as unknown as AccessRequestData;
    const exists = await tx.userRole.findFirst({ where: { userId: d.userId, roleId: d.roleId, departmentId: d.departmentId, academicUnitId: d.academicUnitId, campusId: d.campusId } });
    if (exists) {
      await tx.userRole.update({ where: { id: exists.id }, data: { validUntil: d.validUntil ? new Date(d.validUntil) : null } });
    } else {
      await tx.userRole.create({
        data: {
          userId: d.userId, roleId: d.roleId, departmentId: d.departmentId, academicUnitId: d.academicUnitId, campusId: d.campusId,
          validUntil: d.validUntil ? new Date(d.validUntil) : null, grantedById: null,
        },
      });
    }
    await audit({ actorId: null, actorName: "Workflow", action: "role.grant", resourceType: "user", resourceId: d.userId, summary: `Granted ${d.roleName} (${d.scopeLabel}) via approved access request`, newValue: { role: d.roleKey, scope: d.scopeLabel, validUntil: d.validUntil, workflowInstanceId: instance.id } }, tx);
    await notify({ userIds: [d.userId], type: "access.granted", title: `Access granted: ${d.roleName}`, body: `${d.scopeLabel}${d.validUntil ? ` · until ${d.validUntil.slice(0, 10)}` : ""}. Sign out and in again to see new menus.`, link: "/profile" }, tx);
  },
});
