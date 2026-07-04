export const generatedProjectCodePrefix = "MP-TRK";

export function normalizeClientProjectRef(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
}

export function createInternalTrackingCode(now: Date = new Date(), randomText = Math.random().toString(36).slice(2, 8)): string {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = randomText.replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase() || "DRAFT";

  return `${generatedProjectCodePrefix}-${date}-${suffix}`;
}

export function formatMoldWorkingIdentifier(input: {
  moldCode?: string | null;
  clientProjectRef?: string | null;
  projectCode: string;
}): string {
  const moldCode = input.moldCode?.trim();

  if (moldCode != null && moldCode.length > 0) {
    return moldCode;
  }

  const clientProjectRef = input.clientProjectRef?.trim();

  if (clientProjectRef != null && clientProjectRef.length > 0) {
    return clientProjectRef;
  }

  return input.projectCode;
}

export function formatOptionalIdentifier(value: string | null | undefined, fallback = "Not set"): string {
  const trimmed = value?.trim();
  return trimmed == null || trimmed.length === 0 ? fallback : trimmed;
}
