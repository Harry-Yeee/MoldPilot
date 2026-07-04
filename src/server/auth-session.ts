import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const sessionCookieName = "moldpilot_session";
const sessionVersion = "v1";
const maxAgeSeconds = 60 * 60 * 12;

function secret(): string {
  return process.env.MOLDPILOT_SESSION_SECRET ?? "moldpilot-local-pilot-session-secret";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
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

export function parseSessionToken(token: string | null | undefined): { userId: string } | null {
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

    if (parsed.issuedAt + maxAgeSeconds < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return { userId: parsed.userId };
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
    secure: process.env.NODE_ENV === "production"
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();

  cookieStore.delete(sessionCookieName);
}

export async function getSessionUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  return parseSessionToken(cookieStore.get(sessionCookieName)?.value)?.userId ?? null;
}
