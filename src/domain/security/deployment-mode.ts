type Environment = Readonly<Record<string, string | undefined>>;

export const PRODUCTION_TRAINING_CONFIRMATION = "CREATE MP-DEMO TRAINING DATA";

export function environmentFileValue(contents: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^\\s*${escapedKey}\\s*=\\s*(.*)\\s*$`);

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(pattern);
    if (match == null) {
      continue;
    }

    const value = match[1].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      return value.slice(1, -1).trim();
    }
    return value;
  }

  return undefined;
}

function isProductionDeployment(
  environment: Environment,
  environmentFileContents: string
): boolean {
  return [
    environment.MOLDPILOT_DEPLOYMENT_MODE,
    environmentFileValue(environmentFileContents, "MOLDPILOT_DEPLOYMENT_MODE")
  ].some((mode) => mode?.trim().toLowerCase() === "production");
}

export function assertLocalPilotDeploymentAllowed(
  environment: Environment,
  environmentFileContents: string
): void {
  if (isProductionDeployment(environment, environmentFileContents)) {
    throw new Error(
      "Local pilot setup is disabled for MOLDPILOT_DEPLOYMENT_MODE=production. Deploy with `bash scripts/server-deploy-macos.sh`; no migration or seed was run."
    );
  }
}

export function assertTrainingExamplesDeploymentAllowed(
  environment: Environment,
  environmentFileContents: string,
  confirmation: string | undefined
): { production: boolean } {
  const production = isProductionDeployment(environment, environmentFileContents);
  if (!production) {
    return { production: false };
  }

  if (confirmation !== PRODUCTION_TRAINING_CONFIRMATION) {
    throw new Error(
      `Production training examples require --production-confirm "${PRODUCTION_TRAINING_CONFIRMATION}". No demo data was written.`
    );
  }

  return { production: true };
}
