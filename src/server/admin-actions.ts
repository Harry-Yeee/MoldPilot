"use server";

import type { Prisma, UserStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  assertActiveAdminPath,
  assertProtectedAdminRoleEditable,
  assertProtectedAdminRolePermissions,
  assertProtectedAdminRoleState,
  resolveRoleRemovalMode
} from "@/domain/mold-trial/admin-safety";
import {
  forbiddenCustomerMasterFields,
  normalizeCustomerCode,
  validateCustomerMasterInput
} from "@/domain/mold-trial/customers";
import { evaluatePermission } from "@/domain/mold-trial/permission-evaluator";
import { isPermissionCode, permissionDefinitions, type PermissionCode } from "@/domain/mold-trial/permission-policy";
import { isNumericInjectionMachineNo, normalizeInjectionMachineNo } from "@/domain/mold-trial/process-sheet";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/server/current-user";
import { hashPassword } from "@/server/passwords";
import { requirePermission } from "@/server/permissions";

function value(formData: FormData, key: string): string {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

function optionalValue(formData: FormData, key: string): string | null {
  const next = value(formData, key);
  return next.length === 0 ? null : next;
}

function normalizeRoleCode(raw: string): string {
  return raw.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
}

function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

function optionalString(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function optionalDecimalString(formData: FormData, key: string): string | null {
  const raw = optionalValue(formData, key);

  if (raw == null) {
    return null;
  }

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${key} must be a non-negative number.`);
  }

  return raw;
}

function optionalInteger(formData: FormData, key: string): number | null {
  const raw = optionalValue(formData, key);

  if (raw == null) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${key} must be a non-negative whole number.`);
  }

  return parsed;
}

function decimalActivityValue(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  return String(value);
}

function injectionMachineActivitySnapshot(machine: {
  machineNo: string;
  displayName: string | null;
  model: string | null;
  brand: string | null;
  tonnage: number | null;
  shotCapacityG: unknown;
  nozzleOrificeMm: unknown;
  notes: string | null;
  active: boolean;
}) {
  return {
    machineNo: machine.machineNo,
    clampingForce: machine.tonnage,
    brand: machine.brand,
    shotWeight: decimalActivityValue(machine.shotCapacityG),
    active: machine.active
  };
}

function forbiddenCustomerFields(formData: FormData): string[] {
  return forbiddenCustomerMasterFields.filter((field) => formData.has(field));
}

function redirectPath(formData: FormData): string {
  const path = optionalValue(formData, "redirectTo");
  return path?.startsWith("/") === true ? path : "/admin";
}

function redirectWithMessage(path: string, type: "error" | "success", message: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}${type}=${encodeURIComponent(message)}`);
}

function adminUndoErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Unable to undo the last admin action.";
  }

  if (
    error.message === NO_MORE_ADMIN_UNDOS_MESSAGE ||
    error.message.startsWith("No saved ") ||
    error.message.includes("Unique constraint failed") ||
    error.message.includes("Invalid `") ||
    error.message.includes(".next/")
  ) {
    return NO_MORE_ADMIN_UNDOS_MESSAGE;
  }

  return error.message;
}

function isRedirectSignal(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

type AdminUndoScope = "users" | "clients" | "machines" | "roles";
const ADMIN_UNDO_DEPTH = 10;
const NO_MORE_ADMIN_UNDOS_MESSAGE = "No more undos available.";

type AdminUndoConfig = {
  permissionCode: PermissionCode;
  entityType: "User" | "Customer" | "InjectionMachine" | "Role";
  actions: string[];
  label: string;
};

const adminUndoConfigs: Record<AdminUndoScope, AdminUndoConfig> = {
  users: {
    permissionCode: "admin.manage_users",
    entityType: "User",
    actions: ["admin_created_user", "admin_updated_user", "admin_archived_user", "admin_restored_user"],
    label: "user"
  },
  clients: {
    permissionCode: "admin.manage_customers",
    entityType: "Customer",
    actions: ["admin_created_customer", "admin_updated_customer", "admin_archived_customer", "admin_restored_customer"],
    label: "client"
  },
  machines: {
    permissionCode: "admin.manage_machines",
    entityType: "InjectionMachine",
    actions: [
      "admin_created_injection_machine",
      "admin_updated_injection_machine",
      "admin_deleted_injection_machine",
      "admin_safe_deleted_injection_machine"
    ],
    label: "machine"
  },
  roles: {
    permissionCode: "admin.manage_roles",
    entityType: "Role",
    actions: [
      "admin_created_role",
      "admin_updated_role",
      "admin_archived_role",
      "admin_deleted_role",
      "admin_updated_role_permissions",
      "admin_updated_role_permission_matrix"
    ],
    label: "role"
  }
};

function undoScopeFromForm(formData: FormData): AdminUndoScope {
  const scope = value(formData, "undoScope");

  if (scope === "users" || scope === "clients" || scope === "machines" || scope === "roles") {
    return scope;
  }

  throw new Error("Undo scope is not supported.");
}

function jsonObject(value: Prisma.JsonValue | null | undefined, label: string): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new Error(`${label} snapshot is missing.`);
}

function jsonString(snapshot: Record<string, unknown>, key: string): string {
  const raw = snapshot[key];

  if (typeof raw !== "string") {
    throw new Error(`${key} is missing from the undo snapshot.`);
  }

  return raw;
}

function jsonOptionalString(snapshot: Record<string, unknown>, key: string): string | null {
  const raw = snapshot[key];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function jsonBoolean(snapshot: Record<string, unknown>, key: string, fallback = true): boolean {
  const raw = snapshot[key];
  return typeof raw === "boolean" ? raw : fallback;
}

function jsonOptionalNumber(snapshot: Record<string, unknown>, key: string): number | null {
  const raw = snapshot[key];

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }

  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function permissionCodesFromSnapshot(snapshot: Record<string, unknown>): Set<PermissionCode> {
  const raw = snapshot.permissionCodes;

  if (!Array.isArray(raw)) {
    throw new Error("Permission snapshot is missing.");
  }

  return new Set(raw.filter((code): code is PermissionCode => typeof code === "string" && isPermissionCode(code)));
}

class BatchValidationError extends Error {
  constructor(readonly rowErrors: Record<string, string>) {
    super("Batch validation failed.");
  }
}

async function assertAdminPathAfterChange(
  tx: Prisma.TransactionClient,
  input: {
    userChange?: {
      userId: string;
      nextRoleId: string;
      nextStatus: UserStatus;
    };
    userChanges?: Map<string, {
      nextRoleId: string;
      nextStatus: UserStatus;
    }>;
    rolePermissionChange?: {
      roleId: string;
      enabledPermissionCodes: ReadonlySet<PermissionCode>;
    };
    rolePermissionChanges?: Map<string, ReadonlySet<PermissionCode>>;
    roleActiveChange?: {
      roleId: string;
      nextActive: boolean;
    };
  }
) {
  const [users, roles] = await Promise.all([
    tx.user.findMany({
      include: {
        permissionOverrides: {
          include: {
            permission: true
          }
        }
      }
    }),
    tx.role.findMany({
      include: {
        rolePermissions: {
          include: {
            permission: true
          }
        }
      }
    })
  ]);
  const rolesById = new Map(roles.map((role) => [role.id, role]));

  const adminPathUsers = users.map((user) => {
    const batchUserChange = input.userChanges?.get(user.id);
    const nextRoleId =
      batchUserChange?.nextRoleId ??
      (input.userChange?.userId === user.id ? input.userChange.nextRoleId : user.roleId);
    const nextStatus =
      batchUserChange?.nextStatus ??
      (input.userChange?.userId === user.id ? input.userChange.nextStatus : user.status);
    const role = rolesById.get(nextRoleId);

    if (role == null) {
      return {
        active: false,
        id: user.id,
        permissionCodes: []
      };
    }

    const roleActive =
      input.roleActiveChange?.roleId === role.id ? input.roleActiveChange.nextActive : role.active;
    const matrixPermissionChange =
      input.rolePermissionChanges?.get(role.id) ??
      (input.rolePermissionChange?.roleId === role.id ? input.rolePermissionChange.enabledPermissionCodes : null);
    const permissionCodes = permissionDefinitions
      .map((permission) => permission.code)
      .filter((permissionCode) => {
        const rolePermissionEnabled =
          matrixPermissionChange == null
            ? role.rolePermissions.some(
                (rolePermission) => rolePermission.permission.code === permissionCode && rolePermission.enabled
              )
            : matrixPermissionChange.has(permissionCode);
        const overrides = user.permissionOverrides
          .filter((override) => override.permission.code === permissionCode)
          .map((override) => ({
            effect: override.effect,
            expiresAt: override.expiresAt
          }));

      return evaluatePermission({
        userActive: nextStatus === "ACTIVE",
        roleActive,
        rolePermissionEnabled,
        overrides
      });
      });

    return {
      active: nextStatus === "ACTIVE",
      id: user.id,
      permissionCodes
    };
  });

  assertActiveAdminPath(adminPathUsers);
}

export async function updateUserAccount(formData: FormData) {
  const fallback = redirectPath(formData);

  try {
    const actor = await getCurrentUser();
    await requirePermission(actor.id, "admin.manage_users");

    const userId = optionalValue(formData, "userId");
    const username = normalizeUsername(value(formData, "username"));
    const displayName = value(formData, "displayName");
    const chineseName = optionalValue(formData, "chineseName");
    const roleId = value(formData, "roleId");
    const temporaryPassword = optionalValue(formData, "temporaryPassword") ?? "123456";

    if (username.length === 0 || displayName.length === 0 || roleId.length === 0) {
      redirectWithMessage(fallback, "error", "Username, display name, and role are required.");
    }

    if (userId == null && temporaryPassword.length < 6) {
      redirectWithMessage(fallback, "error", "Temporary password must be at least 6 characters.");
    }

    const role = await prisma.role.findUnique({ where: { id: roleId } });

    if (role == null) {
      redirectWithMessage(fallback, "error", "Selected role was not found.");
    }

    const saved = await prisma.$transaction(async (tx) => {
      const before =
        userId == null
          ? null
          : await tx.user.findUnique({
              where: { id: userId },
              select: {
                username: true,
                displayName: true,
                chineseName: true,
                roleId: true,
                status: true
              }
            });
      if (userId != null && before == null) {
        throw new Error("User was not found.");
      }

      if (before?.status === "INACTIVE") {
        throw new Error("Archived users must be restored before editing.");
      }

      if (userId != null) {
        await assertAdminPathAfterChange(tx, {
          userChange: {
            userId,
            nextRoleId: roleId,
            nextStatus: before?.status ?? "ACTIVE"
          }
        });
      }

      const user =
        userId == null
          ? await tx.user.create({
              data: {
                username,
                displayName,
                chineseName,
                passwordHash: hashPassword(temporaryPassword),
                forcePasswordChange: true,
                roleId,
                departmentGroupId: null,
                status: "ACTIVE"
              }
            })
          : await tx.user.update({
              where: { id: userId },
              data: {
                username,
                displayName,
                chineseName,
                roleId,
                departmentGroupId: null
              }
            });

      await tx.activityLog.create({
        data: {
          actorUserId: actor.id,
          entityType: "User",
          entityId: user.id,
          action: userId == null ? "admin_created_user" : "admin_updated_user",
          beforeJson: before == null ? undefined : before,
          afterJson: {
            username: user.username,
            displayName: user.displayName,
            chineseName: user.chineseName,
            forcePasswordChange: user.forcePasswordChange,
            roleId: user.roleId,
            status: user.status
          }
        }
      });

      return user;
    });

    revalidatePath("/admin");
    redirectWithMessage(fallback, "success", `Saved account ${saved.username}.`);
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", error instanceof Error ? error.message : "Unable to save account.");
  }
}

export async function archiveUserAccount(formData: FormData) {
  const fallback = redirectPath(formData);

  try {
    const actor = await getCurrentUser();
    await requirePermission(actor.id, "admin.manage_users");

    const userId = value(formData, "userId");

    if (userId.length === 0) {
      redirectWithMessage(fallback, "error", "User is required.");
    }

    const archived = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          displayName: true,
          id: true,
          roleId: true,
          status: true,
          username: true
        }
      });

      if (user == null) {
        throw new Error("User was not found.");
      }

      if (user.status === "INACTIVE") {
        throw new Error("User is already archived.");
      }

      await assertAdminPathAfterChange(tx, {
        userChange: {
          userId: user.id,
          nextRoleId: user.roleId,
          nextStatus: "INACTIVE"
        }
      });

      const updated = await tx.user.update({
        where: { id: user.id },
        data: {
          status: "INACTIVE"
        }
      });

      await tx.activityLog.create({
        data: {
          actorUserId: actor.id,
          entityType: "User",
          entityId: updated.id,
          action: "admin_archived_user",
          beforeJson: {
            displayName: user.displayName,
            roleId: user.roleId,
            status: user.status,
            username: user.username
          },
          afterJson: {
            displayName: updated.displayName,
            roleId: updated.roleId,
            status: updated.status,
            username: updated.username
          }
        }
      });

      return updated;
    });

    revalidatePath("/admin");
    redirectWithMessage(fallback, "success", `Archived account ${archived.username}.`);
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", error instanceof Error ? error.message : "Unable to archive account.");
  }
}

export async function restoreUserAccount(formData: FormData) {
  const fallback = redirectPath(formData);

  try {
    const actor = await getCurrentUser();
    await requirePermission(actor.id, "admin.manage_users");

    const userId = value(formData, "userId");

    if (userId.length === 0) {
      redirectWithMessage(fallback, "error", "User is required.");
    }

    const restored = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: {
          displayName: true,
          id: true,
          roleId: true,
          status: true,
          username: true
        }
      });

      if (user == null) {
        throw new Error("User was not found.");
      }

      if (user.status === "ACTIVE") {
        throw new Error("User is already active.");
      }

      const updated = await tx.user.update({
        where: { id: user.id },
        data: {
          status: "ACTIVE"
        }
      });

      await tx.activityLog.create({
        data: {
          actorUserId: actor.id,
          entityType: "User",
          entityId: updated.id,
          action: "admin_restored_user",
          beforeJson: {
            displayName: user.displayName,
            roleId: user.roleId,
            status: user.status,
            username: user.username
          },
          afterJson: {
            displayName: updated.displayName,
            roleId: updated.roleId,
            status: updated.status,
            username: updated.username
          }
        }
      });

      return updated;
    });

    revalidatePath("/admin");
    redirectWithMessage(fallback, "success", `Restored account ${restored.username}.`);
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", error instanceof Error ? error.message : "Unable to restore account.");
  }
}

export async function resetUserPassword(formData: FormData) {
  const fallback = redirectPath(formData);

  try {
    const actor = await getCurrentUser();
    await requirePermission(actor.id, "admin.manage_users");

    const userId = value(formData, "userId");
    const temporaryPassword = optionalValue(formData, "temporaryPassword") ?? "123456";

    if (userId.length === 0) {
      redirectWithMessage(fallback, "error", "User is required.");
    }

    if (temporaryPassword.length < 6) {
      redirectWithMessage(fallback, "error", "Temporary password must be at least 6 characters.");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash: hashPassword(temporaryPassword),
          forcePasswordChange: true,
          passwordUpdatedAt: new Date()
        }
      });

      await tx.activityLog.create({
        data: {
          actorUserId: actor.id,
          entityType: "User",
          entityId: user.id,
          action: "admin_reset_user_password",
          afterJson: {
            username: user.username,
            forcePasswordChange: user.forcePasswordChange
          }
        }
      });

      return user;
    });

    revalidatePath("/admin");
    redirectWithMessage(fallback, "success", `Reset password for ${updated.username}.`);
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", error instanceof Error ? error.message : "Unable to reset password.");
  }
}

export type AdminBatchActionState = {
  ok: boolean;
  message: string | null;
  rowErrors: Record<string, string>;
  version: number;
};

const emptyBatchActionState: AdminBatchActionState = {
  ok: false,
  message: null,
  rowErrors: {},
  version: 0
};

type UserBatchChange = {
  id: string;
  username: string;
  displayName: string;
  chineseName: string | null;
  roleId: string;
  status: UserStatus;
};

type CustomerBatchChange = {
  id: string;
  code: string;
  shortName: string;
  ownerUserId: string | null;
  notes: string | null;
  active: boolean;
};

function parseJsonArray<T>(formData: FormData, key: string): T[] {
  const raw = optionalValue(formData, key);

  if (raw == null) {
    return [];
  }

  const parsed: unknown = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error("Batch payload must be an array.");
  }

  return parsed as T[];
}

function batchError(message: string, rowErrors: Record<string, string> = {}): AdminBatchActionState {
  return {
    ok: false,
    message,
    rowErrors,
    version: Date.now()
  };
}

function rowId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function batchUpdateUserAccounts(
  _previousState: AdminBatchActionState = emptyBatchActionState,
  formData: FormData
): Promise<AdminBatchActionState> {
  try {
    const actor = await getCurrentUser();
    await requirePermission(actor.id, "admin.manage_users");

    const submitted = parseJsonArray<Partial<UserBatchChange>>(formData, "changesJson");
    const rowErrors: Record<string, string> = {};
    const changes = submitted.map((change) => ({
      id: rowId(change.id),
      username: normalizeUsername(String(change.username ?? "")),
      displayName: String(change.displayName ?? "").trim(),
      chineseName: optionalString(change.chineseName),
      roleId: rowId(change.roleId),
      status: change.status === "INACTIVE" ? "INACTIVE" as const : "ACTIVE" as const
    }));

    if (changes.length === 0) {
      return batchError("No user changes to save.");
    }

    for (const change of changes) {
      if (change.id.length === 0) {
        rowErrors.unknown = "User row is missing an id.";
        continue;
      }

      if (change.username.length === 0 || change.displayName.length === 0 || change.roleId.length === 0) {
        rowErrors[change.id] = "Username, display name, and role are required.";
      }
    }

    const seenUsernames = new Map<string, string>();
    for (const change of changes) {
      const existingId = seenUsernames.get(change.username);
      if (existingId != null && existingId !== change.id) {
        rowErrors[change.id] = `Username ${change.username} is duplicated in the batch.`;
      }
      seenUsernames.set(change.username, change.id);
    }

    if (Object.keys(rowErrors).length > 0) {
      return batchError("Some user rows need attention.", rowErrors);
    }

    const result = await prisma.$transaction(async (tx) => {
      const [existingUsers, roles, duplicateUsers] = await Promise.all([
        tx.user.findMany({
          where: { id: { in: changes.map((change) => change.id) } },
          select: {
            id: true,
            username: true,
            displayName: true,
            chineseName: true,
            roleId: true,
            status: true,
            forcePasswordChange: true
          }
        }),
        tx.role.findMany({
          where: { id: { in: [...new Set(changes.map((change) => change.roleId))] } },
          select: { id: true }
        }),
        tx.user.findMany({
          where: { username: { in: changes.map((change) => change.username) } },
          select: { id: true, username: true }
        })
      ]);
      const usersById = new Map(existingUsers.map((user) => [user.id, user]));
      const roleIds = new Set(roles.map((role) => role.id));

      for (const change of changes) {
        const before = usersById.get(change.id);

        if (before == null) {
          rowErrors[change.id] = "User was not found.";
          continue;
        }

        if (!roleIds.has(change.roleId)) {
          rowErrors[change.id] = "Selected role was not found.";
          continue;
        }

        const duplicate = duplicateUsers.find((user) => user.username === change.username && user.id !== change.id);
        if (duplicate != null) {
          rowErrors[change.id] = `Username ${change.username} already exists.`;
        }
      }

      if (Object.keys(rowErrors).length > 0) {
        throw new BatchValidationError(rowErrors);
      }

      await assertAdminPathAfterChange(tx, {
        userChanges: new Map(
          changes.map((change) => [
            change.id,
            {
              nextRoleId: change.roleId,
              nextStatus: change.status
            }
          ])
        )
      });

      let savedCount = 0;
      for (const change of changes) {
        const before = usersById.get(change.id);
        if (before == null) {
          continue;
        }

        const changed =
          before.username !== change.username ||
          before.displayName !== change.displayName ||
          (before.chineseName ?? null) !== (change.chineseName ?? null) ||
          before.roleId !== change.roleId ||
          before.status !== change.status;

        if (!changed) {
          continue;
        }

        const updated = await tx.user.update({
          where: { id: change.id },
          data: {
            username: change.username,
            displayName: change.displayName,
            chineseName: change.chineseName,
            roleId: change.roleId,
            status: change.status,
            departmentGroupId: null
          }
        });
        const action =
          before.status === "ACTIVE" && updated.status === "INACTIVE"
            ? "admin_archived_user"
            : before.status === "INACTIVE" && updated.status === "ACTIVE"
              ? "admin_restored_user"
              : "admin_updated_user";

        await tx.activityLog.create({
          data: {
            actorUserId: actor.id,
            entityType: "User",
            entityId: updated.id,
            action,
            beforeJson: before,
            afterJson: {
              username: updated.username,
              displayName: updated.displayName,
              chineseName: updated.chineseName,
              forcePasswordChange: updated.forcePasswordChange,
              roleId: updated.roleId,
              status: updated.status
            }
          }
        });
        savedCount += 1;
      }

      return savedCount;
    });

    revalidatePath("/admin");
    return {
      ok: true,
      message: `Saved ${result} user ${result === 1 ? "row" : "rows"}.`,
      rowErrors: {},
      version: Date.now()
    };
  } catch (error) {
    if (error instanceof BatchValidationError) {
      return batchError("Some user rows need attention.", error.rowErrors);
    }

    return batchError(error instanceof Error ? error.message : "Unable to save user changes.");
  }
}

export async function batchUpdateCustomers(
  _previousState: AdminBatchActionState = emptyBatchActionState,
  formData: FormData
): Promise<AdminBatchActionState> {
  try {
    const actor = await getCurrentUser();
    await requirePermission(actor.id, "admin.manage_customers");

    const submitted = parseJsonArray<Partial<CustomerBatchChange>>(formData, "changesJson");
    const rowErrors: Record<string, string> = {};
    const changes = submitted.map((change) => ({
      id: rowId(change.id),
      code: normalizeCustomerCode(String(change.code ?? "")),
      shortName: String(change.shortName ?? "").trim(),
      ownerUserId: optionalString(change.ownerUserId),
      notes: optionalString(change.notes),
      active: change.active === false ? false : true
    }));

    if (changes.length === 0) {
      return batchError("No client changes to save.");
    }

    for (const change of changes) {
      if (change.id.length === 0) {
        rowErrors.unknown = "Client row is missing an id.";
        continue;
      }

      const validation = validateCustomerMasterInput({
        code: change.code,
        displayName: change.shortName,
        shortName: change.shortName,
        forbiddenFields: []
      });

      if (!validation.ok) {
        rowErrors[change.id] = validation.issues[0]?.message ?? "Client row is invalid.";
      }
    }

    const seenCodes = new Map<string, string>();
    for (const change of changes) {
      const existingId = seenCodes.get(change.code);
      if (existingId != null && existingId !== change.id) {
        rowErrors[change.id] = `Client code ${change.code} is duplicated in the batch.`;
      }
      seenCodes.set(change.code, change.id);
    }

    if (Object.keys(rowErrors).length > 0) {
      return batchError("Some client rows need attention.", rowErrors);
    }

    const result = await prisma.$transaction(async (tx) => {
      const [existingCustomers, duplicateCustomers, ownerUsers] = await Promise.all([
        tx.customer.findMany({
          where: { id: { in: changes.map((change) => change.id) } },
          select: {
            id: true,
            code: true,
            displayName: true,
            shortName: true,
            ownerUserId: true,
            aliases: true,
            notes: true,
            active: true
          }
        }),
        tx.customer.findMany({
          where: { code: { in: changes.map((change) => change.code) } },
          select: { id: true, code: true }
        }),
        tx.user.findMany({
          where: { id: { in: changes.map((change) => change.ownerUserId).filter((id): id is string => id != null) } },
          select: { id: true, status: true }
        })
      ]);
      const customersById = new Map(existingCustomers.map((customer) => [customer.id, customer]));
      const ownersById = new Map(ownerUsers.map((user) => [user.id, user]));

      for (const change of changes) {
        const before = customersById.get(change.id);

        if (before == null) {
          rowErrors[change.id] = "Client was not found.";
          continue;
        }

        const duplicate = duplicateCustomers.find((customer) => customer.code === change.code && customer.id !== change.id);
        if (duplicate != null) {
          rowErrors[change.id] = `Client code ${change.code} already exists.`;
          continue;
        }

        if (change.ownerUserId != null) {
          const owner = ownersById.get(change.ownerUserId);
          if (owner == null) {
            rowErrors[change.id] = "Selected client owner was not found.";
            continue;
          }

          if (owner.status !== "ACTIVE") {
            rowErrors[change.id] = "Client owner must be an active user.";
          }
        }
      }

      if (Object.keys(rowErrors).length > 0) {
        throw new BatchValidationError(rowErrors);
      }

      let savedCount = 0;
      for (const change of changes) {
        const before = customersById.get(change.id);
        if (before == null) {
          continue;
        }

        const changed =
          before.code !== change.code ||
          before.shortName !== change.shortName ||
          before.displayName !== change.shortName ||
          (before.ownerUserId ?? null) !== (change.ownerUserId ?? null) ||
          (before.notes ?? null) !== (change.notes ?? null) ||
          before.active !== change.active;

        if (!changed) {
          continue;
        }

        const customer = await tx.customer.update({
          where: { id: change.id },
          data: {
            code: change.code,
            displayName: change.shortName,
            shortName: change.shortName,
            ownerUserId: change.ownerUserId,
            notes: change.notes,
            active: change.active,
            updatedById: actor.id
          }
        });
        const action =
          before.active && !customer.active
            ? "admin_archived_customer"
            : !before.active && customer.active
              ? "admin_restored_customer"
              : "admin_updated_customer";

        await tx.activityLog.create({
          data: {
            actorUserId: actor.id,
            entityType: "Customer",
            entityId: customer.id,
            action,
            beforeJson: before,
            afterJson: {
              code: customer.code,
              displayName: customer.displayName,
              shortName: customer.shortName,
              ownerUserId: customer.ownerUserId,
              notes: customer.notes,
              active: customer.active
            }
          }
        });
        savedCount += 1;
      }

      return savedCount;
    });

    revalidatePath("/");
    revalidatePath("/admin");
    return {
      ok: true,
      message: `Saved ${result} client ${result === 1 ? "row" : "rows"}.`,
      rowErrors: {},
      version: Date.now()
    };
  } catch (error) {
    if (error instanceof BatchValidationError) {
      return batchError("Some client rows need attention.", error.rowErrors);
    }

    return batchError(error instanceof Error ? error.message : "Unable to save client changes.");
  }
}

export async function saveCustomer(formData: FormData) {
  const fallback = redirectPath(formData);

  try {
    const actor = await getCurrentUser();
    await requirePermission(actor.id, "admin.manage_customers");

    const customerId = optionalValue(formData, "customerId");
    const code = normalizeCustomerCode(value(formData, "code"));
    const shortName = value(formData, "shortName");
    const displayName = shortName;
    const ownerUserId = optionalValue(formData, "ownerUserId");
    const aliases = optionalValue(formData, "aliases");
    const notes = optionalValue(formData, "notes");
    const validation = validateCustomerMasterInput({
      code,
      displayName,
      shortName,
      forbiddenFields: forbiddenCustomerFields(formData)
    });

    if (!validation.ok) {
      redirectWithMessage(fallback, "error", validation.issues[0]?.message ?? "Customer validation failed.");
    }

    const saved = await prisma.$transaction(async (tx) => {
      const before =
        customerId == null
          ? null
          : await tx.customer.findUnique({
              where: { id: customerId },
              select: {
                code: true,
                displayName: true,
                shortName: true,
                ownerUserId: true,
                aliases: true,
                notes: true,
                active: true
              }
            });

      if (customerId != null && before == null) {
        throw new Error("Client was not found.");
      }

      const duplicate = await tx.customer.findUnique({ where: { code } });
      if (duplicate != null && duplicate.id !== customerId) {
        throw new Error(`Client code ${code} already exists.`);
      }

      const ownerUser =
        ownerUserId == null
          ? null
          : await tx.user.findUnique({
              where: { id: ownerUserId },
              select: {
                id: true,
                status: true
              }
            });

      if (ownerUserId != null && ownerUser == null) {
        throw new Error("Selected client owner was not found.");
      }

      if (ownerUser != null && ownerUser.status !== "ACTIVE") {
        throw new Error("Client owner must be an active user.");
      }

      const customer =
        customerId == null
          ? await tx.customer.create({
              data: {
                code,
                displayName,
                shortName,
                ownerUserId: ownerUser?.id ?? null,
                aliases,
                notes,
                active: true,
                createdById: actor.id,
                updatedById: actor.id
              }
            })
          : await tx.customer.update({
              where: { id: customerId },
              data: {
                code,
                displayName,
                shortName,
                ownerUserId: ownerUser?.id ?? null,
                aliases,
                notes,
                updatedById: actor.id
              }
            });

      await tx.activityLog.create({
        data: {
          actorUserId: actor.id,
          entityType: "Customer",
          entityId: customer.id,
          action: customerId == null ? "admin_created_customer" : "admin_updated_customer",
          beforeJson: before == null ? undefined : before,
          afterJson: {
            code: customer.code,
            displayName: customer.displayName,
            shortName: customer.shortName,
            ownerUserId: customer.ownerUserId,
            aliases: customer.aliases,
            notes: customer.notes,
            active: customer.active
          }
        }
      });

      return customer;
    });

    revalidatePath("/");
    revalidatePath("/admin");
    redirectWithMessage(fallback, "success", `Saved client ${saved.code}.`);
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", error instanceof Error ? error.message : "Unable to save client.");
  }
}

export async function archiveCustomer(formData: FormData) {
  const fallback = redirectPath(formData);

  try {
    const actor = await getCurrentUser();
    await requirePermission(actor.id, "admin.manage_customers");

    const customerId = value(formData, "customerId");
    if (customerId.length === 0) {
      redirectWithMessage(fallback, "error", "Client is required.");
    }

    const archived = await prisma.$transaction(async (tx) => {
      const before = await tx.customer.findUnique({
        where: { id: customerId },
        select: {
          id: true,
          code: true,
          displayName: true,
          shortName: true,
          ownerUserId: true,
          active: true
        }
      });

      if (before == null) {
        throw new Error("Client was not found.");
      }

      if (!before.active) {
        throw new Error("Client is already archived.");
      }

      const customer = await tx.customer.update({
        where: { id: before.id },
        data: {
          active: false,
          updatedById: actor.id
        }
      });

      await tx.activityLog.create({
        data: {
          actorUserId: actor.id,
          entityType: "Customer",
          entityId: customer.id,
          action: "admin_archived_customer",
          beforeJson: before,
          afterJson: {
            code: customer.code,
            displayName: customer.displayName,
            shortName: customer.shortName,
            ownerUserId: customer.ownerUserId,
            active: customer.active
          }
        }
      });

      return customer;
    });

    revalidatePath("/");
    revalidatePath("/admin");
    redirectWithMessage(fallback, "success", `Archived client ${archived.code}.`);
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", error instanceof Error ? error.message : "Unable to archive client.");
  }
}

export async function restoreCustomer(formData: FormData) {
  const fallback = redirectPath(formData);

  try {
    const actor = await getCurrentUser();
    await requirePermission(actor.id, "admin.manage_customers");

    const customerId = value(formData, "customerId");
    if (customerId.length === 0) {
      redirectWithMessage(fallback, "error", "Client is required.");
    }

    const restored = await prisma.$transaction(async (tx) => {
      const before = await tx.customer.findUnique({
        where: { id: customerId },
        select: {
          id: true,
          code: true,
          displayName: true,
          shortName: true,
          ownerUserId: true,
          active: true
        }
      });

      if (before == null) {
        throw new Error("Client was not found.");
      }

      if (before.active) {
        throw new Error("Client is already active.");
      }

      const customer = await tx.customer.update({
        where: { id: before.id },
        data: {
          active: true,
          updatedById: actor.id
        }
      });

      await tx.activityLog.create({
        data: {
          actorUserId: actor.id,
          entityType: "Customer",
          entityId: customer.id,
          action: "admin_restored_customer",
          beforeJson: before,
          afterJson: {
            code: customer.code,
            displayName: customer.displayName,
            shortName: customer.shortName,
            ownerUserId: customer.ownerUserId,
            active: customer.active
          }
        }
      });

      return customer;
    });

    revalidatePath("/");
    revalidatePath("/admin");
    redirectWithMessage(fallback, "success", `Restored client ${restored.code}.`);
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", error instanceof Error ? error.message : "Unable to restore client.");
  }
}

export async function saveInjectionMachine(formData: FormData) {
  const fallback = redirectPath(formData);

  try {
    const actor = await getCurrentUser();
    await requirePermission(actor.id, "admin.manage_machines");

    const machineId = optionalValue(formData, "machineId");
    const machineNo = normalizeInjectionMachineNo(value(formData, "machineNo"));
    const brand = optionalValue(formData, "brand");
    const tonnage = optionalInteger(formData, "tonnage");
    const shotCapacityG = optionalDecimalString(formData, "shotCapacityG");

    if (machineNo.length === 0) {
      redirectWithMessage(fallback, "error", "Machine No. is required.");
    }

    if (!isNumericInjectionMachineNo(machineNo)) {
      redirectWithMessage(fallback, "error", "Machine No. must be numeric only.");
    }

    const saved = await prisma.$transaction(async (tx) => {
      const before =
        machineId == null
          ? null
          : await tx.injectionMachine.findUnique({
              where: { id: machineId },
              select: {
                id: true,
                machineNo: true,
                displayName: true,
                model: true,
                brand: true,
                tonnage: true,
                shotCapacityG: true,
                nozzleOrificeMm: true,
                notes: true,
                active: true
              }
            });

      if (machineId != null && before == null) {
        throw new Error("Injection machine was not found.");
      }

      const duplicate = await tx.injectionMachine.findUnique({ where: { machineNo } });
      if (duplicate != null && duplicate.id !== machineId) {
        throw new Error(`Machine number ${machineNo} already exists.`);
      }

      const machine =
        machineId == null
          ? await tx.injectionMachine.create({
              data: {
                machineNo,
                displayName: null,
                model: null,
                brand,
                tonnage,
                shotCapacityG,
                nozzleOrificeMm: null,
                notes: null,
                active: true
              }
            })
          : await tx.injectionMachine.update({
              where: { id: machineId },
              data: {
                machineNo,
                displayName: null,
                model: null,
                brand,
                tonnage,
                shotCapacityG,
                nozzleOrificeMm: null,
                notes: null,
                active: before?.active ?? true
              }
            });

      const action = before == null ? "admin_created_injection_machine" : "admin_updated_injection_machine";

      await tx.activityLog.create({
        data: {
          actorUserId: actor.id,
          entityType: "InjectionMachine",
          entityId: machine.id,
          action,
          beforeJson: before == null ? undefined : injectionMachineActivitySnapshot(before),
          afterJson: injectionMachineActivitySnapshot(machine)
        }
      });

      return machine;
    });

    revalidatePath("/admin");
    redirectWithMessage(fallback, "success", `Saved injection machine ${saved.machineNo}.`);
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(
      fallback,
      "error",
      error instanceof Error ? error.message : "Unable to save injection machine."
    );
  }
}

export async function deleteInjectionMachine(formData: FormData) {
  const fallback = redirectPath(formData);

  try {
    const actor = await getCurrentUser();
    await requirePermission(actor.id, "admin.manage_machines");

    const machineId = optionalValue(formData, "machineId");

    if (machineId == null) {
      redirectWithMessage(fallback, "error", "Injection machine is required.");
    }

    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.injectionMachine.findUnique({
        where: { id: machineId },
        select: {
          id: true,
          machineNo: true,
          displayName: true,
          model: true,
          brand: true,
          tonnage: true,
          shotCapacityG: true,
          nozzleOrificeMm: true,
          notes: true,
          active: true
        }
      });

      if (before == null) {
        throw new Error("Injection machine was not found.");
      }

      const trialEventCount = await tx.trialEvent.count({
        where: { injectionMachineId: before.id }
      });

      if (trialEventCount === 0) {
        await tx.injectionMachine.delete({ where: { id: before.id } });
        await tx.activityLog.create({
          data: {
            actorUserId: actor.id,
            entityType: "InjectionMachine",
            entityId: before.id,
            action: "admin_deleted_injection_machine",
            beforeJson: injectionMachineActivitySnapshot(before),
            afterJson: { ...injectionMachineActivitySnapshot(before), deleted: true }
          }
        });

        return { machineNo: before.machineNo, mode: "deleted" as const };
      }

      const hidden = await tx.injectionMachine.update({
        where: { id: before.id },
        data: { active: false }
      });
      await tx.activityLog.create({
        data: {
          actorUserId: actor.id,
          entityType: "InjectionMachine",
          entityId: hidden.id,
          action: "admin_safe_deleted_injection_machine",
          beforeJson: injectionMachineActivitySnapshot(before),
          afterJson: { ...injectionMachineActivitySnapshot(hidden), safeDeleted: true }
        }
      });

      return { machineNo: hidden.machineNo, mode: "hidden" as const };
    });

    revalidatePath("/admin");
    redirectWithMessage(
      fallback,
      "success",
      result.mode === "deleted"
        ? `Deleted injection machine ${result.machineNo}.`
        : `Hid injection machine ${result.machineNo} from future selectors.`
    );
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(
      fallback,
      "error",
      error instanceof Error ? error.message : "Unable to delete injection machine."
    );
  }
}

function injectionMachineDataFromSnapshot(snapshot: Record<string, unknown>) {
  const machineNo = normalizeInjectionMachineNo(jsonString(snapshot, "machineNo"));

  if (!isNumericInjectionMachineNo(machineNo)) {
    throw new Error("Machine undo snapshot has a nonnumeric machine No.");
  }

  return {
    machineNo,
    displayName: null,
    model: null,
    brand: jsonOptionalString(snapshot, "brand"),
    tonnage: jsonOptionalNumber(snapshot, "clampingForce"),
    shotCapacityG: jsonOptionalString(snapshot, "shotWeight"),
    nozzleOrificeMm: null,
    notes: null,
    active: jsonBoolean(snapshot, "active", true)
  };
}

async function restoreRolePermissionsFromSnapshot(
  tx: Prisma.TransactionClient,
  roleId: string,
  actorUserId: string,
  snapshot: Record<string, unknown>
) {
  const role = await tx.role.findUnique({
    where: { id: roleId },
    select: {
      id: true,
      code: true,
      active: true
    }
  });

  if (role == null) {
    throw new Error("Role was not found for permission undo.");
  }

  const permissionCodes = permissionCodesFromSnapshot(snapshot);
  assertProtectedAdminRoleState({
    roleCode: role.code,
    nextActive: role.active
  });
  assertProtectedAdminRolePermissions({
    roleCode: role.code,
    permissionCodes: [...permissionCodes]
  });
  await assertAdminPathAfterChange(tx, {
    rolePermissionChange: {
      roleId: role.id,
      enabledPermissionCodes: permissionCodes
    }
  });

  const permissions = await tx.permission.findMany();
  for (const permission of permissions) {
    const enabled = isPermissionCode(permission.code) && permissionCodes.has(permission.code);
    await tx.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId,
          permissionId: permission.id
        }
      },
      update: {
        enabled,
        updatedById: actorUserId
      },
      create: {
        roleId,
        permissionId: permission.id,
        enabled,
        updatedById: actorUserId
      }
    });
  }
}

async function createUndoActivityLog(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  log: {
    id: string;
    entityType: string;
    entityId: string;
    action: string;
    beforeJson: Prisma.JsonValue | null;
    afterJson: Prisma.JsonValue | null;
  }
) {
  await tx.activityLog.create({
    data: {
      actorUserId,
      entityType: log.entityType,
      entityId: log.entityId,
      action: `admin_undid_${log.action}`,
      beforeJson: {
        undoneActivityLogId: log.id,
        undoneAction: log.action,
        previousAfterJson: log.afterJson ?? null
      },
      afterJson: {
        restoredBeforeJson: log.beforeJson ?? null
      }
    }
  });
}

function undoneActivityLogId(log: { action: string; beforeJson: Prisma.JsonValue | null }): string | null {
  if (!log.action.startsWith("admin_undid_") || typeof log.beforeJson !== "object" || log.beforeJson == null || Array.isArray(log.beforeJson)) {
    return null;
  }

  const id = (log.beforeJson as Record<string, unknown>).undoneActivityLogId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function adminUndoGroupKey(log: { actorUserId: string; createdAt: Date }): string {
  return `${log.actorUserId}:${log.createdAt.toISOString()}`;
}

function selectNextAdminUndoGroup<
  T extends {
    id: string;
    actorUserId: string;
    action: string;
    createdAt: Date;
    beforeJson: Prisma.JsonValue | null;
  }
>(logs: T[], originalActions: readonly string[]): T[] {
  const originalActionSet = new Set(originalActions);
  const undoneIds = new Set(logs.map(undoneActivityLogId).filter((id): id is string => id != null));
  const undoGroups = new Map<string, T[]>();
  const seenOriginalGroups = new Set<string>();

  for (const log of logs) {
    if (!originalActionSet.has(log.action)) {
      continue;
    }

    const key = adminUndoGroupKey(log);
    if (!seenOriginalGroups.has(key)) {
      if (seenOriginalGroups.size >= ADMIN_UNDO_DEPTH) {
        break;
      }

      seenOriginalGroups.add(key);
    }

    if (undoneIds.has(log.id)) {
      continue;
    }

    const group = undoGroups.get(key);
    if (group == null) {
      undoGroups.set(key, [log]);
    } else {
      group.push(log);
    }
  }

  return undoGroups.values().next().value ?? [];
}

async function undoUserLog(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  log: {
    id: string;
    entityType: string;
    entityId: string;
    action: string;
    beforeJson: Prisma.JsonValue | null;
    afterJson: Prisma.JsonValue | null;
  }
) {
  if (log.action === "admin_created_user") {
    const after = jsonObject(log.afterJson, "User create");
    const roleId = jsonString(after, "roleId");
    await assertAdminPathAfterChange(tx, {
      userChange: {
        userId: log.entityId,
        nextRoleId: roleId,
        nextStatus: "INACTIVE"
      }
    });
    await tx.user.update({
      where: { id: log.entityId },
      data: { status: "INACTIVE" }
    });
    await createUndoActivityLog(tx, actorUserId, log);
    return;
  }

  const before = jsonObject(log.beforeJson, "User");
  const roleId = jsonString(before, "roleId");
  const status = jsonString(before, "status") === "INACTIVE" ? "INACTIVE" : "ACTIVE";
  await assertAdminPathAfterChange(tx, {
    userChange: {
      userId: log.entityId,
      nextRoleId: roleId,
      nextStatus: status
    }
  });
  await tx.user.update({
    where: { id: log.entityId },
    data: {
      username: normalizeUsername(jsonString(before, "username")),
      displayName: jsonString(before, "displayName"),
      chineseName: jsonOptionalString(before, "chineseName"),
      roleId,
      status,
      departmentGroupId: null
    }
  });
  await createUndoActivityLog(tx, actorUserId, log);
}

async function undoCustomerLog(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  log: {
    id: string;
    entityType: string;
    entityId: string;
    action: string;
    beforeJson: Prisma.JsonValue | null;
    afterJson: Prisma.JsonValue | null;
  }
) {
  if (log.action === "admin_created_customer") {
    const projectCount = await tx.moldTrialProject.count({ where: { customerId: log.entityId } });

    if (projectCount === 0) {
      await tx.customer.delete({ where: { id: log.entityId } });
    } else {
      await tx.customer.update({
        where: { id: log.entityId },
        data: {
          active: false,
          updatedById: actorUserId
        }
      });
    }
    await createUndoActivityLog(tx, actorUserId, log);
    return;
  }

  const before = jsonObject(log.beforeJson, "Client");
  await tx.customer.update({
    where: { id: log.entityId },
    data: {
      code: normalizeCustomerCode(jsonString(before, "code")),
      displayName: jsonString(before, "displayName"),
      shortName: jsonString(before, "shortName"),
      ownerUserId: jsonOptionalString(before, "ownerUserId"),
      aliases: jsonOptionalString(before, "aliases"),
      notes: jsonOptionalString(before, "notes"),
      active: jsonBoolean(before, "active", true),
      updatedById: actorUserId
    }
  });
  await createUndoActivityLog(tx, actorUserId, log);
}

async function undoInjectionMachineLog(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  log: {
    id: string;
    entityType: string;
    entityId: string;
    action: string;
    beforeJson: Prisma.JsonValue | null;
    afterJson: Prisma.JsonValue | null;
  }
) {
  if (log.action === "admin_created_injection_machine") {
    const trialEventCount = await tx.trialEvent.count({ where: { injectionMachineId: log.entityId } });

    if (trialEventCount === 0) {
      await tx.injectionMachine.delete({ where: { id: log.entityId } });
    } else {
      await tx.injectionMachine.update({
        where: { id: log.entityId },
        data: { active: false }
      });
    }
    await createUndoActivityLog(tx, actorUserId, log);
    return;
  }

  const before = jsonObject(log.beforeJson, "Injection machine");
  const data = injectionMachineDataFromSnapshot(before);

  if (log.action === "admin_deleted_injection_machine") {
    const existingMachine = await tx.injectionMachine.findFirst({
      where: {
        OR: [{ id: log.entityId }, { machineNo: data.machineNo }]
      },
      select: { id: true }
    });

    if (existingMachine != null) {
      throw new Error(NO_MORE_ADMIN_UNDOS_MESSAGE);
    }

    await tx.injectionMachine.create({
      data: {
        id: log.entityId,
        ...data
      }
    });
  } else {
    await tx.injectionMachine.update({
      where: { id: log.entityId },
      data
    });
  }
  await createUndoActivityLog(tx, actorUserId, log);
}

async function undoRoleLog(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  log: {
    id: string;
    entityType: string;
    entityId: string;
    action: string;
    beforeJson: Prisma.JsonValue | null;
    afterJson: Prisma.JsonValue | null;
  }
) {
  if (log.action === "admin_updated_role_permissions" || log.action === "admin_updated_role_permission_matrix") {
    await restoreRolePermissionsFromSnapshot(tx, log.entityId, actorUserId, jsonObject(log.beforeJson, "Role permission"));
    await createUndoActivityLog(tx, actorUserId, log);
    return;
  }

  if (log.action === "admin_created_role") {
    const role = await tx.role.findUnique({
      where: { id: log.entityId },
      include: {
        _count: {
          select: {
            users: true
          }
        }
      }
    });

    if (role == null) {
      throw new Error("Role was already removed.");
    }

    if (role._count.users === 0) {
      await tx.role.delete({ where: { id: role.id } });
    } else {
      assertProtectedAdminRoleState({
        roleCode: role.code,
        nextActive: false
      });
      await assertAdminPathAfterChange(tx, {
        roleActiveChange: {
          roleId: role.id,
          nextActive: false
        }
      });
      await tx.role.update({
        where: { id: role.id },
        data: { active: false }
      });
    }
    await createUndoActivityLog(tx, actorUserId, log);
    return;
  }

  const before = jsonObject(log.beforeJson, "Role");

  if (log.action === "admin_deleted_role") {
    await tx.role.create({
      data: {
        id: log.entityId,
        code: jsonString(before, "code"),
        name: jsonString(before, "name"),
        description: jsonOptionalString(before, "description"),
        active: jsonBoolean(before, "active", true),
        systemRole: jsonBoolean(before, "systemRole", false)
      }
    });
    await createUndoActivityLog(tx, actorUserId, log);
    return;
  }

  const roleCode = jsonString(before, "code");
  const nextActive = jsonBoolean(before, "active", true);
  assertProtectedAdminRoleEditable({
    roleCode,
    currentName: jsonString(before, "name"),
    nextName: jsonString(before, "name"),
    currentDescription: jsonOptionalString(before, "description"),
    nextDescription: jsonOptionalString(before, "description"),
    nextActive
  });
  assertProtectedAdminRoleState({
    roleCode,
    nextActive
  });
  await assertAdminPathAfterChange(tx, {
    roleActiveChange: {
      roleId: log.entityId,
      nextActive
    }
  });
  await tx.role.update({
    where: { id: log.entityId },
    data: {
      name: jsonString(before, "name"),
      description: jsonOptionalString(before, "description"),
      active: nextActive
    }
  });
  await createUndoActivityLog(tx, actorUserId, log);
}

async function undoActivityLog(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  log: {
    id: string;
    entityType: string;
    entityId: string;
    action: string;
    beforeJson: Prisma.JsonValue | null;
    afterJson: Prisma.JsonValue | null;
  }
) {
  if (log.entityType === "User") {
    await undoUserLog(tx, actorUserId, log);
    return;
  }

  if (log.entityType === "Customer") {
    await undoCustomerLog(tx, actorUserId, log);
    return;
  }

  if (log.entityType === "InjectionMachine") {
    await undoInjectionMachineLog(tx, actorUserId, log);
    return;
  }

  if (log.entityType === "Role") {
    await undoRoleLog(tx, actorUserId, log);
    return;
  }

  throw new Error("This admin action cannot be undone.");
}

export async function undoLastAdminAction(formData: FormData) {
  const fallback = redirectPath(formData);

  try {
    const actor = await getCurrentUser();
    const scope = undoScopeFromForm(formData);
    const config = adminUndoConfigs[scope];
    await requirePermission(actor.id, config.permissionCode);

    const result = await prisma.$transaction(async (tx) => {
      const candidateActions = [
        ...config.actions,
        ...config.actions.map((action) => `admin_undid_${action}`)
      ];
      const activityLogs = await tx.activityLog.findMany({
        where: {
          entityType: config.entityType,
          action: {
            in: candidateActions
          }
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 500
      });
      const logs = selectNextAdminUndoGroup(activityLogs, config.actions);
      const latest = logs.at(0) ?? null;

      if (latest == null) {
        throw new Error(`No saved ${config.label} action is available to undo in the last ${ADMIN_UNDO_DEPTH} changes.`);
      }

      for (const log of logs) {
        await undoActivityLog(tx, actor.id, log);
      }

      return {
        count: logs.length,
        action: latest.action
      };
    });

    revalidatePath("/");
    revalidatePath("/admin");
    redirectWithMessage(
      fallback,
      "success",
      `Undid ${result.count === 1 ? "the last" : `${result.count}`} ${config.label} ${result.count === 1 ? "change" : "changes"}.`
    );
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", adminUndoErrorMessage(error));
  }
}

export async function saveRole(formData: FormData) {
  const fallback = redirectPath(formData);

  try {
    const actor = await getCurrentUser();
    await requirePermission(actor.id, "admin.manage_roles");

    const roleId = optionalValue(formData, "roleId");
    const code = normalizeRoleCode(value(formData, "code"));
    const name = value(formData, "name");
    const description = optionalValue(formData, "description");
    const active = value(formData, "active") === "false" ? false : true;

    if (name.length === 0) {
      redirectWithMessage(fallback, "error", "Role name is required.");
    }

    if (roleId == null && !/^[a-z0-9_]+$/.test(code)) {
      redirectWithMessage(fallback, "error", "Role code must use lowercase letters, numbers, or underscores.");
    }

    const saved = await prisma.$transaction(async (tx) => {
      const before =
        roleId == null
          ? null
          : await tx.role.findUnique({
              where: { id: roleId },
              select: {
                code: true,
                name: true,
                description: true,
                active: true,
                systemRole: true
              }
            });

      if (roleId != null && before == null) {
        throw new Error("Selected role was not found.");
      }

      if (roleId != null && before != null) {
        assertProtectedAdminRoleEditable({
          roleCode: before.code,
          currentName: before.name,
          nextName: name,
          currentDescription: before.description,
          nextDescription: description,
          nextActive: active
        });
        assertProtectedAdminRoleState({
          roleCode: before.code,
          nextActive: active
        });
        await assertAdminPathAfterChange(tx, {
          roleActiveChange: {
            roleId,
            nextActive: active
          }
        });
      }

      const role =
        roleId == null
          ? await tx.role.create({
              data: {
                code,
                name,
                description,
                active
              }
            })
          : await tx.role.update({
              where: { id: roleId },
              data: {
                name,
                description,
                active
              }
            });

      await tx.activityLog.create({
        data: {
          actorUserId: actor.id,
          entityType: "Role",
          entityId: role.id,
          action: roleId == null ? "admin_created_role" : "admin_updated_role",
          beforeJson: before == null ? undefined : before,
          afterJson: {
            code: role.code,
            name: role.name,
            description: role.description,
            active: role.active
          }
        }
      });

      return role;
    });

    revalidatePath("/admin");
    redirectWithMessage(fallback, "success", `Saved role ${saved.name}.`);
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", error instanceof Error ? error.message : "Unable to save role.");
  }
}

export async function removeRole(formData: FormData) {
  const fallback = redirectPath(formData);

  try {
    const actor = await getCurrentUser();
    await requirePermission(actor.id, "admin.manage_roles");

    const roleId = value(formData, "roleId");

    if (roleId.length === 0) {
      redirectWithMessage(fallback, "error", "Role is required.");
    }

    const result = await prisma.$transaction(async (tx) => {
      const role = await tx.role.findUnique({
        where: { id: roleId },
        include: {
          _count: {
            select: {
              users: true
            }
          }
        }
      });

      if (role == null) {
        throw new Error("Selected role was not found.");
      }

      const removalMode = resolveRoleRemovalMode({
        roleCode: role.code,
        assignedUserCount: role._count.users
      });
      const before = {
        code: role.code,
        name: role.name,
        description: role.description,
        active: role.active,
        assignedUserCount: role._count.users
      };

      if (removalMode === "ARCHIVE") {
        assertProtectedAdminRoleState({
          roleCode: role.code,
          nextActive: false
        });
        await assertAdminPathAfterChange(tx, {
          roleActiveChange: {
            roleId: role.id,
            nextActive: false
          }
        });

        const archived = await tx.role.update({
          where: { id: role.id },
          data: {
            active: false
          }
        });

        await tx.activityLog.create({
          data: {
            actorUserId: actor.id,
            entityType: "Role",
            entityId: role.id,
            action: "admin_archived_role",
            beforeJson: before,
            afterJson: {
              code: archived.code,
              name: archived.name,
              active: archived.active
            }
          }
        });

        return {
          mode: removalMode,
          roleName: archived.name
        };
      }

      await tx.role.delete({
        where: { id: role.id }
      });

      await tx.activityLog.create({
        data: {
          actorUserId: actor.id,
          entityType: "Role",
          entityId: role.id,
          action: "admin_deleted_role",
          beforeJson: before
        }
      });

      return {
        mode: removalMode,
        roleName: role.name
      };
    });

    revalidatePath("/admin");
    redirectWithMessage(
      fallback,
      "success",
      result.mode === "DELETE" ? `Deleted role ${result.roleName}.` : `Archived role ${result.roleName}.`
    );
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", error instanceof Error ? error.message : "Unable to remove role.");
  }
}

export async function updateRolePermissions(formData: FormData) {
  const fallback = redirectPath(formData);

  try {
    const actor = await getCurrentUser();
    await requirePermission(actor.id, "admin.manage_roles");

    const roleId = value(formData, "roleId");
    const checkedPermissionCodes = new Set(
      formData
        .getAll("permissionCode")
        .filter((raw): raw is string => typeof raw === "string")
        .map((raw) => raw.trim())
        .filter(isPermissionCode)
    );

    const role = await prisma.role.findUnique({
      where: { id: roleId },
      include: {
        rolePermissions: {
          include: {
            permission: true
          }
        }
      }
    });

    if (role == null) {
      redirectWithMessage(fallback, "error", "Selected role was not found.");
    }
    assertProtectedAdminRolePermissions({
      roleCode: role.code,
      permissionCodes: [...checkedPermissionCodes]
    });

    const permissions = await prisma.permission.findMany();
    const beforeEnabled = role.rolePermissions
      .filter((rolePermission) => rolePermission.enabled)
      .map((rolePermission) => rolePermission.permission.code)
      .sort();

    await prisma.$transaction(async (tx) => {
      await assertAdminPathAfterChange(tx, {
        rolePermissionChange: {
          roleId: role.id,
          enabledPermissionCodes: checkedPermissionCodes
        }
      });

      for (const permission of permissions) {
        const enabled = isPermissionCode(permission.code) && checkedPermissionCodes.has(permission.code);
        await tx.rolePermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: role.id,
              permissionId: permission.id
            }
          },
          update: {
            enabled,
            updatedById: actor.id
          },
          create: {
            roleId: role.id,
            permissionId: permission.id,
            enabled,
            updatedById: actor.id
          }
        });
      }

      await tx.activityLog.create({
        data: {
          actorUserId: actor.id,
          entityType: "Role",
          entityId: role.id,
          action: "admin_updated_role_permissions",
          beforeJson: {
            permissionCodes: beforeEnabled
          },
          afterJson: {
            permissionCodes: permissionDefinitions
              .map((permission) => permission.code)
              .filter((permissionCode) => checkedPermissionCodes.has(permissionCode))
              .sort()
          }
        }
      });
    });

    revalidatePath("/admin");
    redirectWithMessage(fallback, "success", `Updated permissions for ${role.name}.`);
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", error instanceof Error ? error.message : "Unable to update permissions.");
  }
}

export async function updateRolePermissionMatrix(formData: FormData) {
  const fallback = redirectPath(formData);

  try {
    const actor = await getCurrentUser();
    await requirePermission(actor.id, "admin.manage_roles");

    const submittedRoleIds = formData
      .getAll("matrixRoleId")
      .filter((raw): raw is string => typeof raw === "string" && raw.trim().length > 0)
      .map((raw) => raw.trim());
    const uniqueRoleIds = [...new Set(submittedRoleIds)];

    if (uniqueRoleIds.length === 0) {
      redirectWithMessage(fallback, "error", "At least one role column is required.");
    }

    const checkedByRoleId = new Map<string, Set<PermissionCode>>();
    for (const roleId of uniqueRoleIds) {
      checkedByRoleId.set(
        roleId,
        new Set(
          formData
            .getAll(`permissionCode:${roleId}`)
            .filter((raw): raw is string => typeof raw === "string")
            .map((raw) => raw.trim())
            .filter(isPermissionCode)
        )
      );
    }

    const [roles, permissions] = await Promise.all([
      prisma.role.findMany({
        where: {
          id: { in: uniqueRoleIds }
        },
        include: {
          rolePermissions: {
            include: {
              permission: true
            }
          }
        }
      }),
      prisma.permission.findMany()
    ]);

    if (roles.length !== uniqueRoleIds.length) {
      redirectWithMessage(fallback, "error", "One or more selected roles were not found.");
    }

    for (const role of roles) {
      const checkedPermissionCodes = checkedByRoleId.get(role.id) ?? new Set<PermissionCode>();
      assertProtectedAdminRoleState({
        roleCode: role.code,
        nextActive: role.active
      });
      assertProtectedAdminRolePermissions({
        roleCode: role.code,
        permissionCodes: [...checkedPermissionCodes]
      });
    }

    await prisma.$transaction(async (tx) => {
      await assertAdminPathAfterChange(tx, {
        rolePermissionChanges: checkedByRoleId
      });

      for (const role of roles) {
        const checkedPermissionCodes = checkedByRoleId.get(role.id) ?? new Set<PermissionCode>();
        const beforeEnabled = role.rolePermissions
          .filter((rolePermission) => rolePermission.enabled)
          .map((rolePermission) => rolePermission.permission.code)
          .sort();
        const afterEnabled = permissionDefinitions
          .map((permission) => permission.code)
          .filter((permissionCode) => checkedPermissionCodes.has(permissionCode))
          .sort();

        for (const permission of permissions) {
          const enabled = isPermissionCode(permission.code) && checkedPermissionCodes.has(permission.code);
          await tx.rolePermission.upsert({
            where: {
              roleId_permissionId: {
                roleId: role.id,
                permissionId: permission.id
              }
            },
            update: {
              enabled,
              updatedById: actor.id
            },
            create: {
              roleId: role.id,
              permissionId: permission.id,
              enabled,
              updatedById: actor.id
            }
          });
        }

        await tx.activityLog.create({
          data: {
            actorUserId: actor.id,
            entityType: "Role",
            entityId: role.id,
            action: "admin_updated_role_permission_matrix",
            beforeJson: {
              permissionCodes: beforeEnabled
            },
            afterJson: {
              permissionCodes: afterEnabled
            }
          }
        });
      }
    });

    revalidatePath("/admin");
    redirectWithMessage(fallback, "success", "Saved role permission matrix.");
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", error instanceof Error ? error.message : "Unable to save permission matrix.");
  }
}
