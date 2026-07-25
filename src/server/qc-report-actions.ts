"use server";

import { redirect } from "next/navigation";

/**
 * Compatibility guard for stale clients. Current report uploads stream through
 * `/api/uploads`; keeping this action fail-closed prevents an old page from
 * bypassing quarantine and malware scanning.
 */

function value(formData: FormData, key: string): string {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

function redirectPath(formData: FormData, fallback: string): string {
  const path = value(formData, "redirectTo");
  return path.startsWith("/") ? path : fallback;
}

function redirectWithMessage(path: string, type: "error" | "success", message: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}${type}=${encodeURIComponent(message)}`);
}

export async function uploadMeasurementReport(formData: FormData) {
  const fallback = redirectPath(formData, "/");
  redirectWithMessage(
    fallback,
    "error",
    "This upload form is outdated. Refresh the page and use the protected uploader."
  );
}
