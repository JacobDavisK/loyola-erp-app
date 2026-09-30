# Authorisation (RBAC + scope-based ABAC)

## Model

- **Permission**: a key such as `student.view` or `paper.approve`, catalogued in `src/lib/domain/permissions.ts` (`PERMISSIONS`).
- **Role**: a named set of permissions. System roles are seeded from `SYSTEM_ROLES`. Administrators can edit them and create custom roles under *Configuration centre → Roles & permissions*.
- **Grant** (`UserRole`): user × role × scope, with an optional expiry (`validUntil`).

### Grant scope

| Role type | Scope on the grant | Resolves to |
|---|---|---|
| Global role (`Role.isGlobal`) | ignored | all departments (`null` in the grants map) |
| Departmental role | `departmentId` | that department |
| | `academicUnitId` | every department under the faculty/school/centre, including nested units |
| | `campusId` | every department on the campus (directly, or through its unit's campus) |
| | none | the holder's own department |

Resolution happens once per request in `buildAuthContext` (`src/server/auth/current.ts`) using the pure `departmentsForScope` (`src/lib/domain/org-scope.ts`). The result is `grants: Map<permission, Set<departmentId> | null>`.

A database CHECK constraint (`UserRole_single_scope`) guarantees a grant has at most one scope. Expired grants are ignored when the context is built, so expiry takes effect on the next request.

## Enforcement points

1. **Pages**: `requirePageAuth(perm)` redirects to *Access restricted*.
2. **Actions / API**: `requireAuth(perm)` or `api(handler, { perm })` returns 401/403.
3. **Queries** (object level): where-builders such as `paperWhere(ctx)`, `questionWhere(ctx)` and `instanceWhere(ctx)` add the scope to every query. A record outside the caller's scope is indistinguishable from a missing one, which prevents IDOR and enumeration.
4. **Relations**: some checks depend on a relationship rather than a permission. Examples: "is the assigned moderator" (papers) and "is the task assignee" (workflow).
5. **Database**: triggers make history tables append-only and freeze approved papers.

`can(ctx, perm, departmentId?)` answers "may this user do X for department D?". `scopeOf(ctx, perm)` returns `null` (all), `[]` (none) or a list of department ids for building queries.

## Separation of duties

- **Super Admin** (institution policy): holds **every permission** of every role, globally. It can also stand in for any relationship-bound actor: decide any pending approval task, teach any class, moderate or scrutinise any paper, value any script, and open any student's portal ("view as", read-only).
  - Integrity rules still bind it: it cannot decide a request it raised or that concerns it.
  - Database immutability triggers apply to it as to everyone.
  - Every action is audited under its own name, and stand-in decisions are marked as such.
  - Keep the role to very few people, and require MFA for it (*Configuration centre → Security*).
- **IT Admin** holds no examination-content, student-record or approval permissions: system operation stays separate from confidential data.
- **No self-approval**:
  - the workflow engine excludes the requester and the subject of a request from every approver list;
  - a step whose only possible approvers are excluded is skipped and logged;
  - delegation and reassignment to the requester are refused.
- **Access requests** (`/inbox/new/access`): a role is requested through an approval workflow (HoD, then security). The grant, with any expiry, is created automatically on approval and audited. `SUPER_ADMIN`, `STUDENT` and `GUARDIAN` cannot be requested.
- **HR data**: `employeeWhere(ctx, perm)` scopes employee records by department (plus one's direct reports). Bank and tax identifiers are encrypted at rest (AES-256-GCM), shown only masked, and never written to the audit log. Payslips are visible to payroll staff and, once the run is approved, to the employee alone. Every staff member linked to an employee record gets self-service leave, payslips and appraisal without an extra role (`ctx.subject.employeeId`).
- **Payroll**: HR computes (`payroll.process`), Finance and the Registrar approve through the workflow, Accounts disburses (`payroll.disburse`). No single role can run and pay a payroll alone.
- **Self-scoped roles**: `STUDENT` and `GUARDIAN` carry only self-service permissions (`self.portal`, `enrollment.self`). Portals load data by the signed-in user's own link, never by a parameter.

## Upgrading an existing database

Run `npm run rbac:sync` after migrations. It adds new permissions and roles, and adds new default permissions to system roles. It never removes an administrator's customisation, and every change is audited. `--dry` reports without changing anything.
