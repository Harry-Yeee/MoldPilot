"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { setCurrentUsername } from "@/server/current-user";

function value(formData: FormData, key: string): string {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

function redirectPath(formData: FormData): string {
  const path = value(formData, "redirectTo");
  return path.startsWith("/") ? path : "/";
}

export async function chooseCurrentUser(formData: FormData) {
  const username = value(formData, "username");
  const redirectTo = redirectPath(formData);

  if (username.length === 0) {
    redirect(`${redirectTo}?error=${encodeURIComponent("Choose an account.")}`);
  }

  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      status: true
    }
  });

  if (user == null || user.status !== "ACTIVE") {
    redirect(`${redirectTo}?error=${encodeURIComponent("Selected account is unavailable.")}`);
  }

  await setCurrentUsername(username);
  revalidatePath("/");
  revalidatePath(redirectTo);
  redirect(`${redirectTo}?success=${encodeURIComponent(`Logged in as ${username}.`)}`);
}
