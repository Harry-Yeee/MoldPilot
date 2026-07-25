type Environment = Readonly<Record<string, string | undefined>>;

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

export function assertLocalPilotDeploymentAllowed(
  environment: Environment,
  environmentFileContents: string
): void {
  const configuredModes = [
    environment.MOLDPILOT_DEPLOYMENT_MODE,
    environmentFileValue(environmentFileContents, "MOLDPILOT_DEPLOYMENT_MODE")
  ];

  if (configuredModes.some((mode) => mode?.trim().toLowerCase() === "production")) {
    throw new Error(
      "Local pilot setup is disabled for MOLDPILOT_DEPLOYMENT_MODE=production. Deploy with `bash scripts/server-deploy-macos.sh`; no migration or seed was run."
    );
  }
}
