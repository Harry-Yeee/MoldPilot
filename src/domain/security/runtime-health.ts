export const liveHealthPayload = { status: "ok" } as const;

export type RuntimeComponentStatus = "ready" | "unavailable";

export type RuntimeReadinessReport = {
  status: "ready" | "unavailable";
  components: {
    database: RuntimeComponentStatus;
    storage: RuntimeComponentStatus;
    quarantine: RuntimeComponentStatus;
    scanner: RuntimeComponentStatus;
  };
};

export type RuntimeReadinessChecks = {
  database: () => Promise<void>;
  storage: () => Promise<void>;
  quarantine: () => Promise<void>;
  scanner: () => Promise<void>;
};

export async function runBoundedRuntimeCheck(
  check: () => Promise<void>,
  timeoutMs: number
): Promise<void> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Runtime readiness timeout is invalid.");
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new Error("Runtime dependency check timed out.")),
      timeoutMs
    );
  });
  try {
    await Promise.race([check(), timeoutPromise]);
  } finally {
    if (timeout != null) {
      clearTimeout(timeout);
    }
  }
}

async function componentStatus(
  check: () => Promise<void>,
  timeoutMs: number
): Promise<RuntimeComponentStatus> {
  try {
    await runBoundedRuntimeCheck(check, timeoutMs);
    return "ready";
  } catch {
    return "unavailable";
  }
}

export async function evaluateRuntimeReadiness(
  checks: RuntimeReadinessChecks,
  options: { timeoutMs?: number } = {}
): Promise<RuntimeReadinessReport> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const [database, storage, quarantine, scanner] = await Promise.all([
    componentStatus(checks.database, timeoutMs),
    componentStatus(checks.storage, timeoutMs),
    componentStatus(checks.quarantine, timeoutMs),
    componentStatus(checks.scanner, timeoutMs)
  ]);
  const ready =
    database === "ready" &&
    storage === "ready" &&
    quarantine === "ready" &&
    scanner === "ready";

  return {
    status: ready ? "ready" : "unavailable",
    components: { database, storage, quarantine, scanner }
  };
}

export function runtimeReadinessHttpStatus(report: RuntimeReadinessReport): 200 | 503 {
  return report.status === "ready" ? 200 : 503;
}
