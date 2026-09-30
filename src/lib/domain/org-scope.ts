/**
 * Organisation scope resolution. A role grant may be scoped to a department, an academic unit
 * (faculty / school / centre — including every unit nested below it) or a campus. Every scope is
 * resolved to a flat set of department ids, which is what query where-builders filter on.
 */

export interface OrgDepartment {
  id: string;
  academicUnitId: string | null;
  campusId: string | null;
}

export interface OrgUnit {
  id: string;
  parentId: string | null;
  campusId: string | null;
}

export interface OrgMap {
  departments: OrgDepartment[];
  units: OrgUnit[];
}

export interface GrantScope {
  departmentId: string | null;
  academicUnitId: string | null;
  campusId: string | null;
}

/** The unit and all of its descendants. Cycles (bad data) are tolerated. */
export function unitWithDescendants(org: OrgMap, unitId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const u of org.units) if (u.parentId) (children.get(u.parentId) ?? children.set(u.parentId, []).get(u.parentId)!).push(u.id);
  const out = new Set<string>();
  const stack = [unitId];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

/** Department ids covered by one grant scope. `fallbackDepartmentId` is used when no scope is set. */
export function departmentsForScope(org: OrgMap, scope: GrantScope, fallbackDepartmentId: string | null): string[] {
  if (scope.departmentId) return [scope.departmentId];
  if (scope.academicUnitId) {
    const units = unitWithDescendants(org, scope.academicUnitId);
    return org.departments.filter((d) => d.academicUnitId && units.has(d.academicUnitId)).map((d) => d.id);
  }
  if (scope.campusId) {
    const campusUnits = new Set(org.units.filter((u) => u.campusId === scope.campusId).map((u) => u.id));
    return org.departments
      .filter((d) => d.campusId === scope.campusId || (!d.campusId && d.academicUnitId && campusUnits.has(d.academicUnitId)))
      .map((d) => d.id);
  }
  return fallbackDepartmentId ? [fallbackDepartmentId] : [];
}

/** Ancestors of a unit, nearest first (used for breadcrumbs and approver lookup). */
export function unitAncestors(org: OrgMap, unitId: string): string[] {
  const byId = new Map(org.units.map((u) => [u.id, u]));
  const out: string[] = [];
  let cur = byId.get(unitId)?.parentId ?? null;
  while (cur && !out.includes(cur)) {
    out.push(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  return out;
}

/** True when a grant scope covers the department (used to find approvers for a subject department). */
export function scopeCoversDepartment(org: OrgMap, scope: GrantScope, departmentId: string, fallbackDepartmentId: string | null): boolean {
  return departmentsForScope(org, scope, fallbackDepartmentId).includes(departmentId);
}
