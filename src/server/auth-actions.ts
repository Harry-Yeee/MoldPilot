"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { clearSessionCookie, setSessionCookie } from "@/server/auth-session";
import { getCurrentUser } from "@/server/current-user";
import { hashPassword, verifyPassword } from "@/server/passwords";

function value(formData: FormData, key: string): string {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

function optionalRedirect(formData: FormData, fallback: string): string {
  const path = value(formData, "redirectTo");
  return path.startsWith("/") && !path.startsWith("//") ? path : fallback;
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function redirectWithMessage(path: string, type: "error" | "success", message: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}${type}=${encodeURIComponent(message)}`);
}

function isRedirectSignal(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

function validateNewPassword(password: string, confirmation: string) {
  if (password.length < 8) {
    throw new Error("New password must be at least 8 characters.");
  }

  if (password !== confirmation) {
    throw new Error("Password confirmation does not match.");
  }

  if (password === "123456" || password.toLowerCase() === "admin") {
    throw new Error("Choose a non-temporary password.");
  }
}

export async function login(formData: FormData) {
  const username = normalizeUsername(value(formData, "username"));
  const password = value(formData, "password");
  const redirectTo = optionalRedirect(formData, "/");

  if (username.length === 0 || password.length === 0) {
    redirectWithMessage("/login", "error", "Username and password are required.");
  }

  const user = await prisma.user.findUnique({ where: { username } });

  if (user == null || user.status !== "ACTIVE" || !verifyPassword(password, user.passwordHash)) {
    redirectWithMessage("/login", "error", "Invalid username or password.");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() }
  });
  await setSessionCookie(user.id);

  if (user.forcePasswordChange) {
    redirectWithMessage("/change-password", "success", "Change your temporary password before continuing.");
  }

  redirect(redirectTo);
}

export async function logout() {
  await clearSessionCookie();
  redirect("/login?success=Logged%20out.");
}

export async function changeOwnCredentials(formData: FormData) {
  const user = await getCurrentUser({ allowPasswordChangeRequired: true });
  const fallback = "/change-password";
  const redirectTo = optionalRedirect(formData, "/");
  const currentPassword = value(formData, "currentPassword");
  const nextUsername = normalizeUsername(value(formData, "username"));
  const newPassword = value(formData, "newPassword");
  const confirmPassword = value(formData, "confirmPassword");

  try {
    if (!verifyPassword(currentPassword, user.passwordHash)) {
      throw new Error("Current password is incorrect.");
    }

    if (!/^[a-z0-9._-]+$/.test(nextUsername)) {
      throw new Error("Username may use lowercase letters, numbers, dots, underscores, or hyphens.");
    }

    validateNewPassword(newPassword, confirmPassword);

    const existing = await prisma.user.findUnique({ where: { username: nextUsername } });
    if (existing != null && existing.id !== user.id) {
      throw new Error("Username is already in use.");
    }

    const nextPasswordHash = hashPassword(newPassword);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          username: nextUsername,
          passwordHash: nextPasswordHash,
          forcePasswordChange: false,
          passwordUpdatedAt: new Date()
        }
      });

      const persisted = await tx.user.findUnique({
        where: { id: user.id },
        select: {
          forcePasswordChange: true,
          id: true,
          passwordHash: true,
          username: true
        }
      });

      if (
        persisted == null ||
        persisted.username !== nextUsername ||
        persisted.forcePasswordChange ||
        !verifyPassword(newPassword, persisted.passwordHash)
      ) {
        throw new Error("Password update could not be verified. Try again.");
      }

      await tx.activityLog.create({
        data: {
          actorUserId: user.id,
          entityType: "User",
          entityId: user.id,
          action: "user_changed_credentials",
          beforeJson: { username: user.username, forcePasswordChange: user.forcePasswordChange },
          afterJson: { username: persisted.username, forcePasswordChange: persisted.forcePasswordChange }
        }
      });

      return persisted;
    });

    revalidatePath("/");
    revalidatePath("/change-password");
    await setSessionCookie(updated.id);
    redirectWithMessage(redirectTo, "success", "Password updated.");
  } catch (error) {
    if (isRedirectSignal(error)) {
      throw error;
    }

    redirectWithMessage(fallback, "error", error instanceof Error ? error.message : "Unable to update password.");
  }
}
