/**
 * Session revocation on password change.
 *
 * MoldPilot sessions are stateless signed cookies ({ v, userId, issuedAt }) with
 * a 12-hour lifetime. There is no server-side session table to delete, so a
 * password change cannot "log out" a stolen phone by itself. Instead, every
 * request that already loads the actor row compares the cookie's issue time
 * against `User.passwordUpdatedAt`: a cookie minted BEFORE the current password
 * is treated exactly like an expired cookie.
 *
 * The clock-skew grace exists for two reasons:
 *  - the cookie stores `issuedAt` in whole seconds, so a cookie re-issued in the
 *    same action as the password write can read up to 999 ms "older" than
 *    `passwordUpdatedAt`;
 *  - database and application clocks are not guaranteed to be identical.
 *
 * Without the grace, a user changing their own password could log themselves out
 * of the very session performing the change.
 */

/** Clock-skew grace between the cookie's issue time and `passwordUpdatedAt`. */
export const SESSION_REVOCATION_SKEW_MS = 60_000;

/**
 * True when a session cookie issued at `issuedAtMs` predates the account's
 * current password and must be rejected.
 *
 * - `passwordUpdatedAtMs == null` (never changed / freshly seeded) never revokes.
 * - An unreadable timestamp fails closed once a password change is known.
 */
export function isSessionRevoked(
  issuedAtMs: number,
  passwordUpdatedAtMs: number | null,
  skewMs: number = SESSION_REVOCATION_SKEW_MS
): boolean {
  if (passwordUpdatedAtMs == null) {
    return false;
  }

  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(passwordUpdatedAtMs)) {
    return true;
  }

  const grace = Number.isFinite(skewMs) && skewMs > 0 ? skewMs : 0;

  return issuedAtMs < passwordUpdatedAtMs - grace;
}
