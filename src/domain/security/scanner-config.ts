import type { MalwareScanStatus } from "./upload-security.ts";

export type MalwareScannerMode = "local" | "clamd";

export type MalwareScanResult = {
  status: MalwareScanStatus;
  scanner: string | null;
  detail: string;
};

export const CLAMD_STREAM_CHUNK_BYTES = 64 * 1024;
export const CLAMD_MIN_STREAM_BYTES = 300 * 1024 * 1024;
export const CLAMD_DEFAULT_MAX_STREAM_BYTES = 320 * 1024 * 1024;

const DEFAULT_CONNECT_TIMEOUT_MS = 3_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 5_000;
const DEFAULT_RESPONSE_TIMEOUT_MS = 10_000;
const DEFAULT_TOTAL_SCAN_TIMEOUT_MS = 10 * 60 * 1_000;
const DEFAULT_READINESS_TIMEOUT_MS = 7_000;

type Environment = Readonly<Record<string, string | undefined>>;

export type ClamdConfiguration = {
  host: string;
  port: number;
  connectTimeoutMs: number;
  healthTimeoutMs: number;
  responseTimeoutMs: number;
  totalScanTimeoutMs: number;
  maxStreamBytes: number;
};

function boundedInteger(
  environment: Environment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const raw = environment[name]?.trim();
  if (raw == null || raw.length === 0) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return parsed;
}

export function resolveScannerMode(
  environment: Environment = process.env,
  options: { requireExplicit?: boolean } = {}
): MalwareScannerMode {
  const raw = environment.MOLDPILOT_SCANNER_MODE?.trim().toLowerCase();
  if ((raw == null || raw.length === 0) && options.requireExplicit !== true) {
    return "local";
  }
  if (raw === "local" || raw === "clamd") {
    return raw;
  }
  throw new Error("MOLDPILOT_SCANNER_MODE must be local or clamd.");
}

export function loadClamdConfiguration(
  environment: Environment = process.env
): ClamdConfiguration {
  const host = environment.MOLDPILOT_CLAMD_HOST?.trim() ?? "";
  if (
    host.length === 0 ||
    host.length > 253 ||
    !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host)
  ) {
    throw new Error("MOLDPILOT_CLAMD_HOST must be a valid hostname or IPv4 address.");
  }

  const port = boundedInteger(environment, "MOLDPILOT_CLAMD_PORT", 3310, 1, 65_535);
  const connectTimeoutMs = boundedInteger(
    environment,
    "MOLDPILOT_CLAMD_CONNECT_TIMEOUT_MS",
    DEFAULT_CONNECT_TIMEOUT_MS,
    100,
    30_000
  );
  const healthTimeoutMs = boundedInteger(
    environment,
    "MOLDPILOT_CLAMD_HEALTH_TIMEOUT_MS",
    DEFAULT_HEALTH_TIMEOUT_MS,
    500,
    60_000
  );
  const responseTimeoutMs = boundedInteger(
    environment,
    "MOLDPILOT_CLAMD_RESPONSE_TIMEOUT_MS",
    DEFAULT_RESPONSE_TIMEOUT_MS,
    500,
    60_000
  );
  const totalScanTimeoutMs = boundedInteger(
    environment,
    "MOLDPILOT_CLAMD_SCAN_TIMEOUT_MS",
    DEFAULT_TOTAL_SCAN_TIMEOUT_MS,
    5_000,
    30 * 60 * 1_000
  );
  const maxStreamBytes = boundedInteger(
    environment,
    "MOLDPILOT_CLAMD_MAX_STREAM_BYTES",
    CLAMD_DEFAULT_MAX_STREAM_BYTES,
    CLAMD_MIN_STREAM_BYTES,
    512 * 1024 * 1024
  );

  if (healthTimeoutMs <= connectTimeoutMs) {
    throw new Error(
      "MOLDPILOT_CLAMD_HEALTH_TIMEOUT_MS must be greater than MOLDPILOT_CLAMD_CONNECT_TIMEOUT_MS."
    );
  }
  if (totalScanTimeoutMs <= connectTimeoutMs + responseTimeoutMs) {
    throw new Error(
      "MOLDPILOT_CLAMD_SCAN_TIMEOUT_MS must exceed the connect and response timeout total."
    );
  }

  return {
    host,
    port,
    connectTimeoutMs,
    healthTimeoutMs,
    responseTimeoutMs,
    totalScanTimeoutMs,
    maxStreamBytes
  };
}

export function runtimeReadinessTimeoutMs(
  environment: Environment = process.env
): number {
  return boundedInteger(
    environment,
    "MOLDPILOT_READINESS_TIMEOUT_MS",
    DEFAULT_READINESS_TIMEOUT_MS,
    500,
    60_000
  );
}

export function validateContainerScannerEnvironment(
  environment: Environment = process.env
): ClamdConfiguration {
  if (resolveScannerMode(environment, { requireExplicit: true }) !== "clamd") {
    throw new Error("The container runtime requires MOLDPILOT_SCANNER_MODE=clamd.");
  }
  if ((environment.MOLDPILOT_SCANNER_COMMAND?.trim().length ?? 0) > 0) {
    throw new Error("The container runtime must not configure a local scanner command.");
  }

  const configuration = loadClamdConfiguration(environment);
  if (configuration.host !== "clamav" || configuration.port !== 3310) {
    throw new Error(
      "The D2 container runtime requires the private clamd endpoint clamav:3310."
    );
  }

  runtimeReadinessTimeoutMs(environment);
  return configuration;
}
