import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  forbiddenCustomerMasterFields,
  normalizeCustomerCode,
  searchCustomers,
  validateCustomerMasterInput,
  validateSelectedCustomerForProject,
  type CustomerSearchOption
} from "../../src/domain/mold-trial/customers.ts";
import { clientOwnerUsernameByChineseName } from "../../src/domain/mold-trial/client-owner-mapping.ts";
import { roleCodes, roleHasDefaultPermission } from "../../src/domain/mold-trial/permission-policy.ts";
import { formatBilingualUserOption } from "../../src/domain/mold-trial/users.ts";

const customers: CustomerSearchOption[] = [
  {
    id: "active-1",
    code: "C-027",
    displayName: "Apex Appliances",
    shortName: "Apex",
    aliases: "appliance, home",
    active: true,
    ownerUser: {
      displayName: "Anna",
      chineseName: "刘婉霞"
    }
  },
  {
    id: "active-2",
    code: "C-028",
    displayName: "Beacon Components",
    shortName: "Beacon",
    aliases: "mobility",
    active: true,
    ownerUser: {
      displayName: "Zoe",
      chineseName: "周娟娥"
    }
  },
  {
    id: "archived-1",
    code: "C-OLD",
    displayName: "Archived Customer",
    shortName: "Old",
    aliases: "legacy",
    active: false
  }
];

describe("Customer Master domain rules", () => {
  test("only Admin can manage Customer Master by default", () => {
    const defaultAdmins = roleCodes.filter((roleCode) => roleHasDefaultPermission(roleCode, "admin.manage_customers"));

    assert.deepEqual(defaultAdmins, ["ADMIN"]);
  });

  test("normalizes and validates Customer Master identity fields", () => {
    assert.equal(normalizeCustomerCode(" c-027 "), "C-027");

    const valid = validateCustomerMasterInput({
      code: "C-027",
      displayName: "Apex",
      shortName: "Apex"
    });
    assert.equal(valid.ok, true);

    const invalid = validateCustomerMasterInput({
      code: "bad code with space",
      displayName: "",
      shortName: ""
    });
    assert.equal(invalid.ok, false);
    assert.deepEqual(
      invalid.issues.map((issue) => issue.field),
      ["code", "displayName", "shortName"]
    );
  });

  test("rejects CRM and contact fields from Customer Master", () => {
    const result = validateCustomerMasterInput({
      code: "C-CRM",
      displayName: "CRM Boundary",
      shortName: "CRM",
      forbiddenFields: ["customerEmail", "customerPhone", "quoteValue"]
    });

    assert.equal(result.ok, false);
    assert.equal(result.issues.length, 3);
    assert.equal(forbiddenCustomerMasterFields.includes("customerEmail"), true);
    assert.equal(result.issues.every((issue) => issue.message.includes("Customer Master must not include")), true);
  });

  test("project creation requires an active selected Customer", () => {
    assert.equal(validateSelectedCustomerForProject(null).ok, false);
    assert.equal(validateSelectedCustomerForProject({ active: false }).ok, false);
    assert.equal(validateSelectedCustomerForProject({ active: true }).ok, true);
  });

  test("searches active clients by code, display name, short name, owner names, and aliases, but not country", () => {
    assert.deepEqual(
      searchCustomers(customers, "c-027").map((customer) => customer.code),
      ["C-027"]
    );
    assert.deepEqual(
      searchCustomers(customers, "beacon").map((customer) => customer.code),
      ["C-028"]
    );
    assert.deepEqual(
      searchCustomers(customers, "home").map((customer) => customer.code),
      ["C-027"]
    );
    assert.deepEqual(searchCustomers(customers, "美国").map((customer) => customer.code), []);
    assert.deepEqual(
      searchCustomers(customers, "anna").map((customer) => customer.code),
      ["C-027"]
    );
    assert.deepEqual(
      searchCustomers(customers, "周娟娥").map((customer) => customer.code),
      ["C-028"]
    );
    assert.deepEqual(
      searchCustomers(customers, "legacy").map((customer) => customer.code),
      []
    );
    assert.deepEqual(
      searchCustomers(customers, "legacy", { activeOnly: false }).map((customer) => customer.code),
      ["C-OLD"]
    );
  });

  test("workbook owner names map to the seeded active users", () => {
    assert.deepEqual(clientOwnerUsernameByChineseName, {
      "刘婉霞": "anna",
      "周娟娥": "zoe",
      "彭利满": "peng"
    });
  });

  test("active-user dropdown labels can show English and Chinese names", () => {
    assert.equal(
      formatBilingualUserOption({ displayName: "Anna", chineseName: "刘婉霞", username: "anna" }),
      "Anna / 刘婉霞 (anna)"
    );
    assert.equal(formatBilingualUserOption({ displayName: "Bill", username: "bill" }), "Bill (bill)");
  });
});
