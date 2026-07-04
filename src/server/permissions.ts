import { evaluatePermission } from "@/domain/mold-trial/permission-evaluator";
import {
  isPermissionCode,
  permissionDefinitions,
  type PermissionCode
} from "@/domain/mold-trial/permission-policy";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/server/current-user";

export async function hasPermission(userId: string, permissionCode: PermissionCode): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      role: {
        include: {
          rolePermissions: {
            where: {
              permission: {
                code: permissionCode
              }
            },
            include: {
              permission: true
            }
          }
        }
      },
      permissionOverrides: {
        where: {
          permission: {
            code: permissionCode
          }
        },
        include: {
          permission: true
        }
      }
    }
  });

  if (user == null) {
    return false;
  }

  return evaluatePermission({
    userActive: user.status === "ACTIVE",
    roleActive: user.role.active,
    rolePermissionEnabled: user.role.rolePermissions.some((rolePermission) => rolePermission.enabled),
    overrides: user.permissionOverrides.map((override) => ({
      effect: override.effect,
      expiresAt: override.expiresAt
    }))
  });
}

export async function getEffectivePermissionCodes(userId: string): Promise<PermissionCode[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      role: {
        include: {
          rolePermissions: {
            include: {
              permission: true
            }
          }
        }
      },
      permissionOverrides: {
        include: {
          permission: true
        }
      }
    }
  });

  if (user == null) {
    return [];
  }

  return permissionDefinitions
    .map((permission) => permission.code)
    .filter((permissionCode) => {
      const rolePermissionEnabled = user.role.rolePermissions.some(
        (rolePermission) => rolePermission.permission.code === permissionCode && rolePermission.enabled
      );
      const overrides = user.permissionOverrides
        .filter((override) => override.permission.code === permissionCode)
        .map((override) => ({
          effect: override.effect,
          expiresAt: override.expiresAt
        }));

      return evaluatePermission({
        userActive: user.status === "ACTIVE",
        roleActive: user.role.active,
        rolePermissionEnabled,
        overrides
      });
    });
}

export async function getCurrentUserEffectivePermissionCodes(): Promise<PermissionCode[]> {
  const user = await getCurrentUser();
  return getEffectivePermissionCodes(user.id);
}

export async function requirePermission(userId: string, permissionCode: PermissionCode): Promise<void> {
  if (!(await hasPermission(userId, permissionCode))) {
    throw new Error(`Missing permission: ${permissionCode}`);
  }
}

export async function requirePermissions(userId: string, permissionCodes: readonly PermissionCode[]): Promise<void> {
  for (const permissionCode of permissionCodes) {
    await requirePermission(userId, permissionCode);
  }
}

export async function requireAnyPermission(
  userId: string,
  permissionCodes: readonly PermissionCode[]
): Promise<void> {
  for (const permissionCode of permissionCodes) {
    if (await hasPermission(userId, permissionCode)) {
      return;
    }
  }

  throw new Error(`Missing one of permissions: ${permissionCodes.join(", ")}`);
}

export function parsePermissionCode(value: string): PermissionCode {
  if (!isPermissionCode(value)) {
    throw new Error(`Unknown permission code: ${value}`);
  }

  return value;
}
