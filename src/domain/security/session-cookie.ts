export type SessionCookieSecureMode = "auto" | "true" | "false";

export type ProductionAuthenticationConfiguration = {
  baseUrl: string;
  cookieMode: SessionCookieSecureMode;
  cookieSecure: boolean;
  warning: string | null;
};

type Environment = Readonly<Record<string, string | undefined>>;

const knownDevelopmentSessionSecrets = new Set([
  "moldpilot-local-pilot-session-secret",
  "moldpilot-development-session-secret",
  "change-me",
  "changeme",
  "development",
  "replace-this-session-secret"
]);

export function validateProductionSessionSecret(value: string | undefined): void {
  const secret = value?.trim() ?? "";
  if (secret.length < 32) {
    throw new Error(
      "MOLDPILOT_SESSION_SECRET must contain at least 32 characters in production."
    );
  }
  if (knownDevelopmentSessionSecrets.has(secret.toLowerCase())) {
    throw new Error(
      "MOLDPILOT_SESSION_SECRET must not use a known development value."
    );
  }
}

export function parseSessionCookieSecureMode(value: string | undefined): SessionCookieSecureMode {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized.length === 0) {
    return "auto";
  }
  if (normalized === "auto" || normalized === "true" || normalized === "false") {
    return normalized;
  }

  throw new Error(
    "Invalid MOLDPILOT_SESSION_COOKIE_SECURE value. Expected auto, true, or false."
  );
}

export function shouldUseSecureSessionCookie(
  environment: Environment = process.env
): boolean {
  const mode = parseSessionCookieSecureMode(environment.MOLDPILOT_SESSION_COOKIE_SECURE);
  if (mode === "true") {
    return true;
  }
  if (mode === "false") {
    return false;
  }

  const baseUrl = environment.MOLDPILOT_BASE_URL?.trim().toLowerCase() ?? "";
  if (baseUrl.startsWith("https://")) {
    return true;
  }
  if (baseUrl.startsWith("http://")) {
    return false;
  }

  return environment.NODE_ENV === "production";
}

export function validateProductionAuthenticationEnvironment(
  environment: Environment = process.env
): ProductionAuthenticationConfiguration {
  if (environment.MOLDPILOT_DEPLOYMENT_MODE?.trim().toLowerCase() !== "production") {
    throw new Error("MOLDPILOT_DEPLOYMENT_MODE=production is required for the production service.");
  }
  validateProductionSessionSecret(environment.MOLDPILOT_SESSION_SECRET);

  const configuredBaseUrl = environment.MOLDPILOT_BASE_URL?.trim();
  if (configuredBaseUrl == null || configuredBaseUrl.length === 0) {
    throw new Error("MOLDPILOT_BASE_URL is required for the production service.");
  }

  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(configuredBaseUrl);
  } catch {
    throw new Error("MOLDPILOT_BASE_URL must be a valid absolute HTTP or HTTPS URL.");
  }

  if (
    (parsedBaseUrl.protocol !== "http:" && parsedBaseUrl.protocol !== "https:") ||
    parsedBaseUrl.hostname.length === 0 ||
    parsedBaseUrl.username.length > 0 ||
    parsedBaseUrl.password.length > 0
  ) {
    throw new Error(
      "MOLDPILOT_BASE_URL must be an absolute HTTP or HTTPS URL without embedded credentials."
    );
  }

  const cookieMode = parseSessionCookieSecureMode(environment.MOLDPILOT_SESSION_COOKIE_SECURE);
  const cookieSecure = shouldUseSecureSessionCookie(environment);
  if (parsedBaseUrl.protocol === "https:" && !cookieSecure) {
    throw new Error("HTTPS MOLDPILOT_BASE_URL requires Secure session cookies.");
  }
  if (parsedBaseUrl.protocol === "http:" && cookieSecure) {
    throw new Error("HTTP MOLDPILOT_BASE_URL cannot use Secure session cookies.");
  }

  return {
    baseUrl: parsedBaseUrl.toString().replace(/\/$/, ""),
    cookieMode,
    cookieSecure,
    warning:
      parsedBaseUrl.protocol === "http:"
        ? "HTTP factory-LAN mode does not encrypt credentials or cookies. Never expose this service to the internet."
        : null
  };
}
