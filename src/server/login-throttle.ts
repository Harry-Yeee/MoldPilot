import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { headers } from "next/headers";
import type { LoginThrottleScope, Prisma } from "@prisma/client";
import {
  LOGIN_THROTTLE_RETENTION_MS,
  evaluateLoginThrottle,
  registerLoginFailure,
  strongestLoginThrottleDecision,
  type LoginThrottleDecision,
  type LoginThrottleRecord
} from "@/domain/security/login-throttle";
import { prisma } from "@/lib/prisma";
import { sessionSecret } from "@/server/auth-session";

export type LoginAttemptContext = {
  accountKeyHash: string;
  sourceKeyHash: string;
};

type ThrottleClient = Pick<Prisma.TransactionClient, "loginThrottleBucket">;
const MAX_TRANSACTION_RETRIES = 3;

function throttleKey(scope: LoginThrottleScope, value: string): string {
  return createHmac("sha256", sessionSecret())
    .update(`login-throttle:${scope}:${value}`)
    .digest("hex");
}

function normalizedForwardedAddress(value: string | null): string {
  const candidate = value?.split(",")[0]?.trim() ?? "";
  return isIP(candidate) === 0 ? "unknown-proxy-source" : candidate;
}

export async function getLoginAttemptContext(username: string): Promise<LoginAttemptContext> {
  const requestHeaders = await headers();
  const source =
    process.env.MOLDPILOT_TRUST_PROXY === "1"
      ? normalizedForwardedAddress(requestHeaders.get("x-forwarded-for"))
      : "direct-loopback";

  return {
    accountKeyHash: throttleKey("ACCOUNT", username),
    sourceKeyHash: throttleKey("SOURCE", source)
  };
}

function recordShape(record: {
  failureCount: number;
  firstFailureAt: Date;
  lastFailureAt: Date;
  blockedUntil: Date | null;
}): LoginThrottleRecord {
  return record;
}

export async function checkLoginThrottle(
  context: LoginAttemptContext,
  now = new Date()
): Promise<LoginThrottleDecision> {
  const records = await prisma.loginThrottleBucket.findMany({
    where: {
      OR: [
        { scope: "ACCOUNT", keyHash: context.accountKeyHash },
        { scope: "SOURCE", keyHash: context.sourceKeyHash }
      ]
    },
    select: {
      scope: true,
      failureCount: true,
      firstFailureAt: true,
      lastFailureAt: true,
      blockedUntil: true
    }
  });

  const byScope = new Map(records.map((record) => [record.scope, recordShape(record)]));
  return strongestLoginThrottleDecision([
    evaluateLoginThrottle(byScope.get("ACCOUNT") ?? null, now),
    evaluateLoginThrottle(byScope.get("SOURCE") ?? null, now)
  ]);
}

async function registerBucketFailure(
  tx: ThrottleClient,
  scope: LoginThrottleScope,
  keyHash: string,
  now: Date
): Promise<LoginThrottleRecord> {
  const existing = await tx.loginThrottleBucket.findUnique({
    where: { scope_keyHash: { scope, keyHash } }
  });
  const next = registerLoginFailure(existing == null ? null : recordShape(existing), now);

  await tx.loginThrottleBucket.upsert({
    where: { scope_keyHash: { scope, keyHash } },
    create: {
      scope,
      keyHash,
      failureCount: next.failureCount,
      firstFailureAt: next.firstFailureAt,
      lastFailureAt: next.lastFailureAt,
      blockedUntil: next.blockedUntil
    },
    update: {
      failureCount: next.failureCount,
      firstFailureAt: next.firstFailureAt,
      lastFailureAt: next.lastFailureAt,
      blockedUntil: next.blockedUntil
    }
  });

  return next;
}

export async function recordFailedLogin(
  context: LoginAttemptContext,
  now = new Date()
): Promise<LoginThrottleDecision> {
  let decisions: readonly [LoginThrottleDecision, LoginThrottleDecision] | null = null;
  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt += 1) {
    try {
      decisions = await prisma.$transaction(
        async (tx) => {
          const account = await registerBucketFailure(tx, "ACCOUNT", context.accountKeyHash, now);
          const source = await registerBucketFailure(tx, "SOURCE", context.sourceKeyHash, now);
          return [
            evaluateLoginThrottle(account, now),
            evaluateLoginThrottle(source, now)
          ] as const;
        },
        { isolationLevel: "Serializable" }
      );
      break;
    } catch (error) {
      const code =
        typeof error === "object" && error != null && "code" in error
          ? String((error as { code: unknown }).code)
          : "";
      if (code !== "P2034" || attempt === MAX_TRANSACTION_RETRIES) {
        throw error;
      }
    }
  }
  if (decisions == null) {
    throw new Error("Login throttle transaction could not be completed.");
  }
  const decision = strongestLoginThrottleDecision(decisions);

  console.warn(
    JSON.stringify({
      event: "login_failed",
      accountKey: context.accountKeyHash.slice(0, 12),
      sourceKey: context.sourceKeyHash.slice(0, 12),
      throttled: decision.blocked,
      retryAfterSeconds: Math.ceil(decision.retryAfterMs / 1000)
    })
  );

  void prisma.loginThrottleBucket
    .deleteMany({
      where: {
        lastFailureAt: { lt: new Date(now.getTime() - LOGIN_THROTTLE_RETENTION_MS) }
      }
    })
    .catch(() => undefined);

  return decision;
}

export async function clearLoginThrottle(context: LoginAttemptContext): Promise<void> {
  await prisma.loginThrottleBucket.deleteMany({
    where: {
      scope: "ACCOUNT",
      keyHash: context.accountKeyHash
    }
  });
}

export function logThrottledLogin(
  context: LoginAttemptContext,
  decision: LoginThrottleDecision
): void {
  console.warn(
    JSON.stringify({
      event: "login_throttled",
      accountKey: context.accountKeyHash.slice(0, 12),
      sourceKey: context.sourceKeyHash.slice(0, 12),
      retryAfterSeconds: Math.ceil(decision.retryAfterMs / 1000)
    })
  );
}
