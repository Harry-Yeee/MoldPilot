export const liveHealthPayload = { status: "ok" } as const;

export type RuntimeComponentStatus = "ready" | "unavailable";

export type RuntimeReadinessReport = {
  status: "ready" | "unavailable";
  components: {
    database: RuntimeComponentStatus;
    storage: RuntimeComponentStatus;
    quarantine: RuntimeComponentStatus;
  };
};

export type RuntimeReadinessChecks = {
  database: () => Promise<void>;
  storage: () => Promise<void>;
  quarantine: () => Promise<void>;
};

async function componentStatus(check: () => Promise<void>): Promise<RuntimeComponentStatus> {
  try {
    await check();
    return "ready";
  } catch {
    return "unavailable";
  }
}

export async function evaluateRuntimeReadiness(
  checks: RuntimeReadinessChecks
): Promise<RuntimeReadinessReport> {
  const [database, storage, quarantine] = await Promise.all([
    componentStatus(checks.database),
    componentStatus(checks.storage),
    componentStatus(checks.quarantine)
  ]);
  const ready = database === "ready" && storage === "ready" && quarantine === "ready";

  return {
    status: ready ? "ready" : "unavailable",
    components: { database, storage, quarantine }
  };
}

export function runtimeReadinessHttpStatus(report: RuntimeReadinessReport): 200 | 503 {
  return report.status === "ready" ? 200 : 503;
}
