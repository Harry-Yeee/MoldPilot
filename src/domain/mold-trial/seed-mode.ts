export type MoldPilotSeedMode = "demo" | "production";

export type ProductionBootstrapCounts = {
  users: number;
  projects: number;
  activityLogs: number;
};

export function resolveMoldPilotSeedMode(value: string | undefined): MoldPilotSeedMode {
  const normalized = value?.trim().toLowerCase();

  if (normalized == null || normalized === "" || normalized === "demo") {
    return "demo";
  }

  if (normalized === "production") {
    return "production";
  }

  throw new Error(`Unsupported MOLDPILOT_SEED_MODE "${value}". Use "demo" or "production".`);
}

export function assertFreshProductionBootstrap(counts: ProductionBootstrapCounts): void {
  if (counts.users === 0 && counts.projects === 0 && counts.activityLogs === 0) {
    return;
  }

  throw new Error(
    "Production bootstrap requires a fresh database with no users, projects, or activity logs. " +
      "It will not overwrite live credentials or operational data. Restore a backup instead, or recreate the empty database before retrying."
  );
}
