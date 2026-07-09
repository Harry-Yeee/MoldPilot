import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { formatAccountIdentityLine } from "../../src/domain/mold-trial/users.ts";

describe("formatAccountIdentityLine", () => {
  test("normal user shows username and role separated by a middot", () => {
    assert.equal(formatAccountIdentityLine({ displayName: "Bill", username: "bill", roleName: "PM" }), "bill · PM");
  });

  test("admin account collapses to the role name only", () => {
    assert.equal(formatAccountIdentityLine({ displayName: "Admin", username: "admin", roleName: "Admin" }), "Admin");
  });

  test("collapses when username equals the role name regardless of display name", () => {
    assert.equal(formatAccountIdentityLine({ displayName: "Site Lead", username: "PM", roleName: "PM" }), "PM");
  });

  test("dedupe is case-insensitive but preserves the role name casing", () => {
    assert.equal(formatAccountIdentityLine({ displayName: "ADMIN", username: "Admin", roleName: "admin" }), "admin");
    assert.equal(formatAccountIdentityLine({ displayName: "manager", username: "MANAGER", roleName: "Manager" }), "Manager");
  });

  test("trims surrounding whitespace before comparing and rendering", () => {
    assert.equal(formatAccountIdentityLine({ displayName: " Bill ", username: " bill ", roleName: " PM " }), "bill · PM");
  });
});
