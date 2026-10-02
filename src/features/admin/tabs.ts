import type { PermissionKey } from "@/lib/domain/permissions";

export const ADMIN_TABS = [
  { key: "users", label: "Users", href: "/admin/users", perm: "admin.users.manage" },
  { key: "demo-users", label: "Demo Users", href: "/admin/demo-users", perm: "demo.manage" },
  { key: "roles", label: "Roles & permissions", href: "/admin/roles", perm: "admin.roles.manage" },
  { key: "institution", label: "Institution & branding", href: "/admin/institution", perm: "admin.institution.manage" },
  { key: "workflows", label: "Workflows", href: "/admin/workflows", perm: "workflow.manage" },
  { key: "security", label: "Security", href: "/admin/security", perm: "admin.settings.manage" },
  { key: "workflow", label: "Examination rules", href: "/admin/workflow", perm: "admin.settings.manage" },
  { key: "system", label: "System health", href: "/admin/system", perm: "system.health" },
  { key: "ai", label: "AI assistance", href: "/admin/ai", perm: "admin.settings.manage" },
  { key: "lti", label: "External tools (LTI)", href: "/admin/lti", perm: "lti.manage" },
  { key: "messaging", label: "SMS & WhatsApp", href: "/admin/messaging", perm: "messaging.manage" },
  { key: "integrations", label: "Integrations", href: "/admin/integrations", perm: "integration.manage" },
  { key: "backup", label: "Backup", href: "/admin/backup", perm: "admin.backup" },
] as const satisfies readonly { key: string; label: string; href: string; perm: PermissionKey }[];
