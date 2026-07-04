import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  activeAdminPathUserIds,
  assertActiveAdminPath,
  assertProtectedAdminRoleEditable,
  assertProtectedAdminRolePermissions,
  assertProtectedAdminRoleState,
  hasActiveAdminPath,
  resolveRoleRemovalMode
} from "../../src/domain/mold-trial/admin-safety.ts";

describe("Admin permission lockout safety", () => {
  test("requires at least one active user with both admin management permissions", () => {
    const users = [
      {
        active: true,
        id: "admin-1",
        permissionCodes: ["admin.manage_users", "admin.manage_roles"] as const
      },
      {
        active: true,
        id: "pm-1",
        permissionCodes: ["project.intake.create"] as const
      }
    ];

    assert.equal(hasActiveAdminPath(users), true);
    assert.deepEqual(activeAdminPathUserIds(users), ["admin-1"]);
    assert.doesNotThrow(() => assertActiveAdminPath(users));
  });

  test("blocks removing admin.manage_roles from the last active admin path", () => {
    const users = [
      {
        active: true,
        id: "admin-1",
        permissionCodes: ["admin.manage_users"] as const
      }
    ];

    assert.equal(hasActiveAdminPath(users), false);
    assert.throws(() => assertActiveAdminPath(users), /At least one active account/);
  });

  test("blocks inactivating the last active admin path", () => {
    const users = [
      {
        active: false,
        id: "admin-1",
        permissionCodes: ["admin.manage_users", "admin.manage_roles"] as const
      },
      {
        active: true,
        id: "viewer-1",
        permissionCodes: [] as const
      }
    ];

    assert.equal(hasActiveAdminPath(users), false);
    assert.throws(() => assertActiveAdminPath(users), /At least one active account/);
  });

  test("allows a change when another active admin path remains", () => {
    const users = [
      {
        active: false,
        id: "admin-1",
        permissionCodes: ["admin.manage_users", "admin.manage_roles"] as const
      },
      {
        active: true,
        id: "admin-2",
        permissionCodes: ["admin.manage_users", "admin.manage_roles"] as const
      }
    ];

    assert.equal(hasActiveAdminPath(users), true);
    assert.deepEqual(activeAdminPathUserIds(users), ["admin-2"]);
  });

  test("blocks deactivating the protected Admin role", () => {
    assert.throws(
      () => assertProtectedAdminRoleState({ roleCode: "admin", nextActive: false }),
      /protected Admin role cannot be deactivated/
    );
    assert.doesNotThrow(() => assertProtectedAdminRoleState({ roleCode: "planning_pm", nextActive: false }));
  });

  test("blocks renaming or changing the protected Admin role", () => {
    assert.throws(
      () =>
        assertProtectedAdminRoleEditable({
          roleCode: "admin",
          currentName: "Admin",
          nextName: "Planning PM",
          currentDescription: "System administrator",
          nextDescription: "System administrator",
          nextActive: true
        }),
      /protected Admin role cannot be renamed or changed/
    );
  });

  test("blocks matrix saves that remove protected Admin management permissions", () => {
    assert.throws(
      () =>
        assertProtectedAdminRolePermissions({
          roleCode: "admin",
          permissionCodes: ["admin.manage_users"]
        }),
      /protected Admin role must keep admin.manage_roles/
    );
    assert.doesNotThrow(() =>
      assertProtectedAdminRolePermissions({
        roleCode: "admin",
        permissionCodes: ["admin.manage_users", "admin.manage_roles"]
      })
    );
  });

  test("blocks matrix-style role permission changes that break the last active admin path", () => {
    const usersAfterMatrixSave = [
      {
        active: true,
        id: "admin-1",
        permissionCodes: ["admin.manage_users"] as const
      }
    ];

    assert.throws(() => assertActiveAdminPath(usersAfterMatrixSave), /At least one active account/);
  });

  test("hard-deletes unused non-protected roles", () => {
    assert.equal(
      resolveRoleRemovalMode({
        roleCode: "temporary_role",
        assignedUserCount: 0
      }),
      "DELETE"
    );
  });

  test("archives assigned or historical non-protected roles instead of hard-deleting", () => {
    assert.equal(
      resolveRoleRemovalMode({
        roleCode: "legacy_role",
        assignedUserCount: 2
      }),
      "ARCHIVE"
    );
    assert.equal(
      resolveRoleRemovalMode({
        roleCode: "historical_role",
        assignedUserCount: 0,
        preservedHistoryCount: 1
      }),
      "ARCHIVE"
    );
  });

  test("blocks deleting the protected Admin role", () => {
    assert.throws(
      () =>
        resolveRoleRemovalMode({
          roleCode: "admin",
          assignedUserCount: 0
        }),
      /protected Admin role cannot be deleted/
    );
  });
});
