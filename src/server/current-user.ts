import { redirect } from "next/navigation";
import { isSessionRevoked } from "@/domain/security/session-revocation";
import { prisma } from "@/lib/prisma";
import { getSessionClaims, setSessionCookie } from "@/server/auth-session";
import { roleCodeLabels } from "@/server/mold-trial-codecs";

export const currentUserCookieName = "moldpilot_current_user";
export const explicitDevFallbackUsername = process.env.MOLDPILOT_DEV_DEFAULT_USER ?? "admin";

export type CurrentUser = Awaited<ReturnType<typeof getCurrentUser>>;

export async function setCurrentUsername(username: string) {
  if (process.env.MOLDPILOT_ENABLE_DEV_USER_SELECTOR !== "1") {
    throw new Error("Dev user selector is disabled. Use username/password login.");
  }

  const user = await prisma.user.findUnique({ where: { username } });

  if (user == null || user.status !== "ACTIVE") {
    throw new Error("Selected account is unavailable.");
  }

  await setSessionCookie(user.id);
}

export async function getOptionalCurrentUser(options: { allowPasswordChangeRequired?: boolean } = {}) {
  const session = await getSessionClaims();

  if (session == null) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: {
      role: true
    }
  });

  if (user == null) {
    return null;
  }

  if (user.status !== "ACTIVE") {
    return null;
  }

  // A cookie minted before the account's current password is dead, exactly like
  // an expired cookie: the caller redirects to /login. Changing your own
  // password re-issues this cookie in the same action, so only OTHER devices
  // (and the target of an admin reset) lose their session.
  if (isSessionRevoked(session.issuedAtMs, user.passwordUpdatedAt?.getTime() ?? null)) {
    return null;
  }

  const roleCode = roleCodeLabels[user.role.code];

  if (roleCode == null) {
    throw new Error(`Role ${user.role.code} is not mapped for MoldPilot permissions.`);
  }

  if (user.forcePasswordChange && options.allowPasswordChangeRequired !== true) {
    redirect("/change-password");
  }

  return {
    ...user,
    roleCode
  };
}

export async function getCurrentUser(options: { allowPasswordChangeRequired?: boolean } = {}) {
  const user = await getOptionalCurrentUser(options);

  if (user == null) {
    redirect("/login");
  }

  return user;
}

export async function getSelectableUsers() {
  if (process.env.MOLDPILOT_ENABLE_DEV_USER_SELECTOR !== "1") {
    return [];
  }

  return prisma.user.findMany({
    where: { status: "ACTIVE" },
    include: {
      role: true
    },
    orderBy: [{ isDefaultAdmin: "desc" }, { username: "asc" }]
  });
}
