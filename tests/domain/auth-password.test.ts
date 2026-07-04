import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hashPassword, verifyPassword } from "../../src/server/passwords.ts";

describe("real login password hashing", () => {
  test("hashes passwords without storing plaintext and verifies only the matching password", () => {
    const hash = hashPassword("123456");

    assert.notEqual(hash, "123456");
    assert.equal(hash.startsWith("scrypt-v1$"), true);
    assert.equal(verifyPassword("123456", hash), true);
    assert.equal(verifyPassword("old-password", hash), false);
  });
});
