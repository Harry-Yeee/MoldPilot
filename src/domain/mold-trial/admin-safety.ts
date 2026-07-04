import type { PermissionCode } from "./permission-policy.ts";

export const requiredAdminPathPermissions = [
  "admin.manage_users",
  "admin.manage_roles"
] as const satisfies readonly PermissionCode[];
export const protectedAdminRoleCode = "admin";
export const protectedAdminRolePermissionCodes = requiredAdminPathPermissions;

export type AdminPathUser = {
  id: string;
  active: boolean;
  permissionCodes: readonly PermissionCode[];
};

export function activeAdminPathUserIds(users: readonly AdminPathUser[]): string[] {
  return users
    .filter(
      (user) =>
        user.active &&
        requiredAdminPathPermissions.every((permissionCode) => user.permissionCodes.includes(permissionCode))
    )
    .map((user) => user.id);
}

export function hasActiveAdminPath(users: readonly AdminPathUser[]): boolean {
  return activeAdminPathUserIds(users).length > 0;
}

export function assertActiveAdminPath(users: readonly AdminPathUser[]): void {
  if (!hasActiveAdminPath(users)) {
    throw new Error("At least one active account must retain both admin.manage_users and admin.manage_roles.");
  }
}

export function assertProtectedAdminRoleState(input: { roleCode: string; nextActive: boolean }): void {
  if (input.roleCode === protectedAdminRoleCode && !input.nextActive) {
    throw new Error("The protected Admin role cannot be deactivated.");
  }
}

export function assertProtectedAdminRoleEditable(input: {
  roleCode: string;
  currentName: string;
  nextName: string;
  currentDescription?: string | null;
  nextDescription?: string | null;
  nextActive: boolean;
}): void {
  if (input.roleCode !== protectedAdminRoleCode) {
    return;
  }

  assertProtectedAdminRoleState({
    roleCode: input.roleCode,
    nextActive: input.nextActive
  });

  if (
    input.currentName !== input.nextName ||
    (input.currentDescription ?? null) !== (input.nextDescription ?? null)
  ) {
    throw new Error("The protected Admin role cannot be renamed or changed.");
  }
}

export function assertProtectedAdminRolePermissions(input: {
  roleCode: string;
  permissionCodes: readonly PermissionCode[];
}): void {
  if (input.roleCode !== protectedAdminRoleCode) {
    return;
  }

  const permissionCodes = new Set(input.permissionCodes);
  const missingPermission = protectedAdminRolePermissionCodes.find((permissionCode) => !permissionCodes.has(permissionCode));

  if (missingPermission != null) {
    throw new Error(`The protected Admin role must keep ${missingPermission}.`);
  }
}

export type RoleRemovalMode = "DELETE" | "ARCHIVE";

export function resolveRoleRemovalMode(input: {
  roleCode: string;
  assignedUserCount: number;
  preservedHistoryCount?: number;
}): RoleRemovalMode {
  if (input.roleCode === protectedAdminRoleCode) {
    throw new Error("The protected Admin role cannot be deleted.");
  }

  return input.assignedUserCount > 0 || (input.preservedHistoryCount ?? 0) > 0 ? "ARCHIVE" : "DELETE";
}
