import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  LOGIN_THROTTLE_RESET_MS,
  backoffForFailureCount,
  evaluateLoginThrottle,
  registerLoginFailure,
  strongestLoginThrottleDecision,
  type LoginThrottleRecord
} from "../../src/domain/security/login-throttle.ts";
import { shouldUseSecureSessionCookie } from "../../src/domain/security/session-cookie.ts";

function failures(count: number, start = new Date("2026-07-24T00:00:00.000Z")): LoginThrottleRecord {
  let record: LoginThrottleRecord | null = null;
  for (let index = 0; index < count; index += 1) {
    record = registerLoginFailure(record, new Date(start.getTime() + index * 10));
  }
  assert.ok(record);
  return record;
}

describe("login throttling", () => {
  it("allows ordinary retries before applying progressive temporary backoff", () => {
    assert.equal(backoffForFailureCount(1), 0);
    assert.equal(backoffForFailureCount(2), 0);
    assert.equal(backoffForFailureCount(3), 2_000);
    assert.equal(backoffForFailureCount(4), 5_000);
    assert.equal(backoffForFailureCount(7), 15 * 60 * 1000);
  });

  it("blocks at the threshold and recovers after the temporary delay", () => {
    const record = failures(3);
    assert.equal(evaluateLoginThrottle(record, record.lastFailureAt).blocked, true);
    assert.equal(
      evaluateLoginThrottle(record, new Date(record.blockedUntil!.getTime() + 1)).blocked,
      false
    );
  });

  it("resets stale failures so a legitimate user can recover", () => {
    const record = failures(7);
    const recoveredAt = new Date(record.lastFailureAt.getTime() + LOGIN_THROTTLE_RESET_MS);
    const next = registerLoginFailure(record, recoveredAt);
    assert.equal(next.failureCount, 1);
    assert.equal(next.blockedUntil, null);
  });

  it("source throttling catches attempts distributed across account names", () => {
    const sourceRecord = failures(5);
    const accountDecision = evaluateLoginThrottle(failures(1), sourceRecord.lastFailureAt);
    const sourceDecision = evaluateLoginThrottle(sourceRecord, sourceRecord.lastFailureAt);
    assert.deepEqual(strongestLoginThrottleDecision([accountDecision, sourceDecision]), {
      blocked: true,
      retryAfterMs: 30_000
    });
  });

  it("uses secure cookies only for the configured HTTPS deployment", () => {
    assert.equal(
      shouldUseSecureSessionCookie({ MOLDPILOT_BASE_URL: "https://moldpilot.factory.test" }),
      true
    );
    assert.equal(
      shouldUseSecureSessionCookie({ MOLDPILOT_BASE_URL: "http://localhost:3000" }),
      false
    );
    assert.equal(
      shouldUseSecureSessionCookie({
        MOLDPILOT_BASE_URL: "https://moldpilot.factory.test",
        MOLDPILOT_SESSION_COOKIE_SECURE: "false"
      }),
      false
    );
  });

  it("persists concurrent failures through serializable transactions", () => {
    const source = readFileSync(
      new URL("../../src/server/login-throttle.ts", import.meta.url),
      "utf8"
    );
    assert.match(source, /isolationLevel: "Serializable"/);
    assert.match(source, /code !== "P2034"/);
    assert.match(source, /MAX_TRANSACTION_RETRIES = 3/);
  });
});
