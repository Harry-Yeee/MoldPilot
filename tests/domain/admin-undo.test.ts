import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

describe("Admin undo support", () => {
  test("undo last admin action is server-side and permission-scoped", () => {
    const source = readFileSync(new URL("../../src/server/admin-actions.ts", import.meta.url), "utf8");

    assert.match(source, /export async function undoLastAdminAction/);
    assert.match(source, /users:[\s\S]*permissionCode: "admin\.manage_users"/);
    assert.match(source, /clients:[\s\S]*permissionCode: "admin\.manage_customers"/);
    assert.match(source, /machines:[\s\S]*permissionCode: "admin\.manage_machines"/);
    assert.match(source, /roles:[\s\S]*permissionCode: "admin\.manage_roles"/);
    assert.match(source, /const ADMIN_UNDO_DEPTH = 10/);
    assert.match(source, /selectNextAdminUndoGroup/);
    assert.match(source, /undoneActivityLogId/);
  });

  test("machine undo restores deleted rows and reverses safe-delete", () => {
    const source = readFileSync(new URL("../../src/server/admin-actions.ts", import.meta.url), "utf8");

    assert.match(source, /admin_deleted_injection_machine/);
    assert.match(source, /tx\.injectionMachine\.create\(\{\s*data: \{\s*id: log\.entityId,/);
    assert.match(source, /existingMachine != null/);
    assert.match(source, /NO_MORE_ADMIN_UNDOS_MESSAGE/);
    assert.match(source, /admin_safe_deleted_injection_machine/);
    assert.match(source, /tx\.injectionMachine\.update\(\{\s*where: \{ id: log\.entityId \},\s*data/);
  });

  test("undo errors are formatted without raw Prisma diagnostics", () => {
    const source = readFileSync(new URL("../../src/server/admin-actions.ts", import.meta.url), "utf8");

    assert.match(source, /const NO_MORE_ADMIN_UNDOS_MESSAGE = "No more undos available\."/);
    assert.match(source, /function adminUndoErrorMessage/);
    assert.match(source, /error\.message\.includes\("Unique constraint failed"\)/);
    assert.match(source, /redirectWithMessage\(fallback, "error", adminUndoErrorMessage\(error\)\)/);
    assert.doesNotMatch(source, /Unable to undo last admin action/);
  });

  test("Admin management surfaces expose undo instead of row reset controls", () => {
    const adminPage = readFileSync(new URL("../../src/app/admin/page.tsx", import.meta.url), "utf8");
    const usersEditor = readFileSync(new URL("../../src/app/admin/admin-users-batch-editor.tsx", import.meta.url), "utf8");
    const clientsEditor = readFileSync(new URL("../../src/app/admin/admin-clients-batch-editor.tsx", import.meta.url), "utf8");

    for (const source of [adminPage, usersEditor, clientsEditor]) {
      assert.match(source, /undoLastAdminAction/);
      assert.match(source, /common\.undo|labels\.undo/);
      assert.doesNotMatch(source, /Undo last saved action/);
    }
    assert.doesNotMatch(adminPage, /Reset changes/);
    assert.doesNotMatch(adminPage, /type="reset"/);
  });
});
