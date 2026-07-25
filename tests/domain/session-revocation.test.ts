import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  SESSION_REVOCATION_SKEW_MS,
  isSessionRevoked
} from "../../src/domain/security/session-revocation.ts";

function source(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const changedAt = Date.UTC(2026, 6, 17, 9, 0, 0);

describe("session revocation on password change", () => {
  it("never revokes an account whose password was never changed", () => {
    assert.equal(isSessionRevoked(changedAt - 10 * 60 * 60 * 1000, null), false);
    assert.equal(isSessionRevoked(0, null), false);
    assert.equal(isSessionRevoked(Date.now(), null), false);
  });

  it("revokes cookies issued before the password change", () => {
    assert.equal(isSessionRevoked(changedAt - 60 * 60 * 1000, changedAt), true);
    assert.equal(isSessionRevoked(changedAt - SESSION_REVOCATION_SKEW_MS - 1, changedAt), true);
  });

  it("keeps cookies issued at or after the password change", () => {
    assert.equal(isSessionRevoked(changedAt, changedAt), false);
    assert.equal(isSessionRevoked(changedAt + 1, changedAt), false);
    assert.equal(isSessionRevoked(changedAt + 12 * 60 * 60 * 1000, changedAt), false);
  });

  it("treats the skew boundary as still valid", () => {
    // The exact boundary is inclusive: issuedAt == passwordUpdatedAt - skew survives.
    assert.equal(isSessionRevoked(changedAt - SESSION_REVOCATION_SKEW_MS, changedAt), false);
    assert.equal(isSessionRevoked(changedAt - SESSION_REVOCATION_SKEW_MS + 1, changedAt), false);
    assert.equal(isSessionRevoked(changedAt - SESSION_REVOCATION_SKEW_MS - 1, changedAt), true);
  });

  it("absorbs the whole-second flooring of a cookie re-issued by the same action", () => {
    // createSessionToken stores Math.floor(Date.now() / 1000), so a cookie minted
    // immediately after the password write can read up to 999 ms older.
    const writtenAt = changedAt + 750;
    const reIssuedAt = Math.floor(writtenAt / 1000) * 1000;
    assert.ok(reIssuedAt < writtenAt);
    assert.equal(isSessionRevoked(reIssuedAt, writtenAt), false);
  });

  it("honours an explicit skew, including zero", () => {
    assert.equal(isSessionRevoked(changedAt - 1, changedAt, 0), true);
    assert.equal(isSessionRevoked(changedAt, changedAt, 0), false);
    assert.equal(isSessionRevoked(changedAt - 5 * 60 * 1000, changedAt, 10 * 60 * 1000), false);
    // Negative or unusable skews degrade to zero grace, never to "always valid".
    assert.equal(isSessionRevoked(changedAt - 1, changedAt, -60_000), true);
    assert.equal(isSessionRevoked(changedAt - 1, changedAt, Number.NaN), true);
  });

  it("fails closed on an unreadable issue time once a password change exists", () => {
    assert.equal(isSessionRevoked(Number.NaN, changedAt), true);
    assert.equal(isSessionRevoked(Number.POSITIVE_INFINITY, changedAt), true);
    // Still no revocation without a password change, whatever the cookie says.
    assert.equal(isSessionRevoked(Number.NaN, null), false);
  });

  it("uses a one-minute clock-skew grace", () => {
    assert.equal(SESSION_REVOCATION_SKEW_MS, 60_000);
  });
});

describe("session revocation wiring", () => {
  it("carries the cookie issue time through the session parser", () => {
    const session = source("src/server/auth-session.ts");
    assert.match(session, /issuedAtMs: parsed\.issuedAt \* 1000/);
    assert.match(session, /Number\.isFinite\(parsed\.issuedAt\)/);
    assert.match(session, /export async function getSessionClaims\(\)/);
    // No cookie reader may hand out a user id without the revocation check.
    assert.doesNotMatch(session, /export async function getSessionUserId\(/);
  });

  it("rejects revoked sessions where the actor row is already loaded", () => {
    const currentUser = source("src/server/current-user.ts");
    assert.match(currentUser, /import \{ isSessionRevoked \} from "@\/domain\/security\/session-revocation"/);
    assert.match(
      currentUser,
      /isSessionRevoked\(session\.issuedAtMs, user\.passwordUpdatedAt\?\.getTime\(\) \?\? null\)/
    );
    // Revoked behaves exactly like expired: return null, caller redirects to /login.
    const revocationIndex = currentUser.indexOf("isSessionRevoked(session.issuedAtMs");
    assert.ok(revocationIndex > currentUser.indexOf('user.status !== "ACTIVE"'));
    assert.ok(revocationIndex < currentUser.indexOf("user.forcePasswordChange"));
  });

  it("stamps passwordUpdatedAt on every path that sets a password", () => {
    const authActions = source("src/server/auth-actions.ts");
    const adminActions = source("src/server/admin-actions.ts");

    // Self change + forced first-login change share one action.
    assert.match(authActions, /passwordHash: nextPasswordHash,\s*forcePasswordChange: false,\s*passwordUpdatedAt: new Date\(\)/);
    // Admin reset of another account.
    assert.match(
      adminActions,
      /passwordHash: hashPassword\(temporaryPassword\),\s*forcePasswordChange: true,\s*passwordUpdatedAt: new Date\(\)/
    );
  });

  it("keeps the self-change session alive and leaves other cookies untouched", () => {
    const authActions = source("src/server/auth-actions.ts");
    const adminActions = source("src/server/admin-actions.ts");

    // The re-issue must happen after the password write, before the redirect.
    const writeIndex = authActions.indexOf("passwordUpdatedAt: new Date()");
    const reIssueIndex = authActions.indexOf("await setSessionCookie(updated.id)");
    assert.ok(writeIndex > 0 && reIssueIndex > writeIndex);
    assert.ok(reIssueIndex < authActions.indexOf('redirectWithMessage(redirectTo, "success", "Password updated.")'));

    // Admin reset re-issues a cookie ONLY for a self-reset.
    assert.match(adminActions, /if \(updated\.id === actor\.id\) \{\s*(?:\/\/[^\n]*\n\s*)*await setSessionCookie\(updated\.id\);/);
  });

  it("leaves seeded and newly created accounts with a null passwordUpdatedAt", () => {
    // Null means "never revoked", which is what keeps e2e forged cookies valid.
    const seedPolicy = source("src/domain/security/seed-user-policy.ts");
    assert.match(seedPolicy, /passwordUpdatedAt: null/);
    const adminActions = source("src/server/admin-actions.ts");
    const createBlock = adminActions.slice(
      adminActions.indexOf("await tx.user.create({"),
      adminActions.indexOf('status: "ACTIVE"')
    );
    assert.doesNotMatch(createBlock, /passwordUpdatedAt/);
  });

  it("forges e2e smoke cookies with a current issue time", () => {
    const smoke = source("scripts/e2e-smoke.mjs");
    assert.match(smoke, /const issuedAt = Math\.floor\(Date\.now\(\) \/ 1000\)/);
    // The smoke run must never rewrite credentials, so passwordUpdatedAt stays null.
    assert.doesNotMatch(smoke, /data:\s*\{[^}]*passwordUpdatedAt/s);
  });
});
