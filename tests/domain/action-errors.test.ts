import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { friendlyActionErrorMessage } from "../../src/server/action-errors.ts";

describe("server action error messages", () => {
  test("hides raw Prisma invocation diagnostics from user-facing messages", () => {
    const message = friendlyActionErrorMessage(
      new Error(
        'Invalid `prisma.user.findUnique()` invocation in /Users/ipwaikei/Documents/MoldPilot/.next/dev/server/chunks/ssr/_0ilmbqf._.js:1544:157'
      ),
      "Unable to create project."
    );

    assert.equal(
      message,
      "Database action failed. Check that PostgreSQL is running and that migrations and seed data are applied."
    );
    assert.equal(message.includes("prisma.user.findUnique"), false);
    assert.equal(message.includes(".next/dev/server"), false);
  });

  test("maps missing tables to the migration and seed recovery path", () => {
    const message = friendlyActionErrorMessage(
      new Error('The table `public.users` does not exist in the current database.'),
      "Unable to create project."
    );

    assert.equal(message, "Database tables are missing or out of date. Run pnpm prisma:migrate, then pnpm prisma:seed.");
  });

  test("keeps normal business validation messages intact", () => {
    assert.equal(
      friendlyActionErrorMessage(
        new Error("Only Planning PM or Admin can set PM custom trial limits."),
        "Unable to set custom trial limit."
      ),
      "Only Planning PM or Admin can set PM custom trial limits."
    );
  });
});
