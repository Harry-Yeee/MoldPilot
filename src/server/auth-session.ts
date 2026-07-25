import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { shouldUseSecureSessionCookie } from "@/domain/security/session-cookie";

export { shouldUseSecureSessionCookie } from "@/domain/security/session-cookie";

export const sessionCookieName = "moldpilot_session";
const sessionVersion = "v1";
const maxAgeSeconds = 60 * 60 * 12;
const localDevelopmentSecret = "moldpilot-local-pilot-session-secret";

export function sessionSecret(): string {
  const configured = process.env.MOLDPILOT_SESSION_SECRET?.trim();
  if (configured != null && configured.length > 0) {
    return configured;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("MOLDPILOT_SESSION_SECRET is required in production.");
  }
  return localDevelopmentSecret;
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function verifySignature(payload: string, signature: string): boolean {
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createSessionToken(userId: string): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ v: sessionVersion, userId, issuedAt })).toString("base64url");

  return `${payload}.${sign(payload)}`;
}

/** Claims carried by a signed, unexpired session cookie. */
export type SessionClaims = {
  /** Cookie issue time in milliseconds (the token stores whole seconds). */
  issuedAtMs: number;
  userId: string;
};

export function parseSessionToken(token: string | null | undefined): SessionClaims | null {
  if (token == null || token.length === 0) {
    return null;
  }

  const [payload, signature] = token.split(".");

  if (payload == null || signature == null || !verifySignature(payload, signature)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      issuedAt?: unknown;
      userId?: unknown;
      v?: unknown;
    };

    if (parsed.v !== sessionVersion || typeof parsed.userId !== "string" || typeof parsed.issuedAt !== "number") {
      return null;
    }

    if (!Number.isFinite(parsed.issuedAt)) {
      return null;
    }

    if (parsed.issuedAt + maxAgeSeconds < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return { issuedAtMs: parsed.issuedAt * 1000, userId: parsed.userId };
  } catch {
    return null;
  }
}

export async function setSessionCookie(userId: string) {
  const cookieStore = await cookies();

  cookieStore.set(sessionCookieName, createSessionToken(userId), {
    httpOnly: true,
    maxAge: maxAgeSeconds,
    path: "/",
    sameSite: "lax",
    secure: shouldUseSecureSessionCookie()
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();

  cookieStore.delete(sessionCookieName);
}

/**
 * Reads the session cookie. The caller MUST also apply
 * `isSessionRevoked(claims.issuedAtMs, user.passwordUpdatedAt)` once it has
 * loaded the account row — see `getOptionalCurrentUser`.
 */
export async function getSessionClaims(): Promise<SessionClaims | null> {
  const cookieStore = await cookies();
  return parseSessionToken(cookieStore.get(sessionCookieName)?.value);
}
