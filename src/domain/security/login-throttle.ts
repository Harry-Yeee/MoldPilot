export const LOGIN_THROTTLE_RESET_MS = 30 * 60 * 1000;
export const LOGIN_THROTTLE_RETENTION_MS = 24 * 60 * 60 * 1000;

const BACKOFF_BY_FAILURE_COUNT_MS = new Map<number, number>([
  [3, 2_000],
  [4, 5_000],
  [5, 30_000],
  [6, 2 * 60 * 1000]
]);
const MAX_BACKOFF_MS = 15 * 60 * 1000;

export type LoginThrottleRecord = {
  failureCount: number;
  firstFailureAt: Date;
  lastFailureAt: Date;
  blockedUntil: Date | null;
};

export type LoginThrottleDecision = {
  blocked: boolean;
  retryAfterMs: number;
};

function isExpired(record: LoginThrottleRecord, now: Date): boolean {
  return now.getTime() - record.lastFailureAt.getTime() >= LOGIN_THROTTLE_RESET_MS;
}

export function backoffForFailureCount(failureCount: number): number {
  if (failureCount < 3) {
    return 0;
  }

  return BACKOFF_BY_FAILURE_COUNT_MS.get(failureCount) ?? MAX_BACKOFF_MS;
}

export function evaluateLoginThrottle(
  record: LoginThrottleRecord | null,
  now: Date
): LoginThrottleDecision {
  if (record == null || isExpired(record, now) || record.blockedUntil == null) {
    return { blocked: false, retryAfterMs: 0 };
  }

  const retryAfterMs = Math.max(0, record.blockedUntil.getTime() - now.getTime());
  return { blocked: retryAfterMs > 0, retryAfterMs };
}

export function registerLoginFailure(
  record: LoginThrottleRecord | null,
  now: Date
): LoginThrottleRecord {
  const current = record == null || isExpired(record, now) ? null : record;
  const failureCount = (current?.failureCount ?? 0) + 1;
  const backoffMs = backoffForFailureCount(failureCount);

  return {
    failureCount,
    firstFailureAt: current?.firstFailureAt ?? now,
    lastFailureAt: now,
    blockedUntil: backoffMs === 0 ? null : new Date(now.getTime() + backoffMs)
  };
}

export function strongestLoginThrottleDecision(
  decisions: readonly LoginThrottleDecision[]
): LoginThrottleDecision {
  const retryAfterMs = decisions.reduce(
    (largest, decision) => Math.max(largest, decision.retryAfterMs),
    0
  );
  return { blocked: retryAfterMs > 0, retryAfterMs };
}
