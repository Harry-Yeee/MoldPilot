export type PermissionOverrideEffect = "ALLOW" | "DENY";

export type PermissionOverrideInput = {
  effect: PermissionOverrideEffect;
  expiresAt?: Date | string | null;
};

export function isOverrideActive(
  override: PermissionOverrideInput,
  now: Date = new Date()
): boolean {
  if (override.expiresAt == null) {
    return true;
  }

  return new Date(override.expiresAt).getTime() > now.getTime();
}

export function evaluatePermission(input: {
  rolePermissionEnabled: boolean;
  roleActive?: boolean;
  userActive?: boolean;
  overrides?: readonly PermissionOverrideInput[];
  now?: Date;
}): boolean {
  if (input.userActive === false || input.roleActive === false) {
    return false;
  }

  const activeOverrides = (input.overrides ?? []).filter((override) =>
    isOverrideActive(override, input.now)
  );

  if (activeOverrides.some((override) => override.effect === "DENY")) {
    return false;
  }

  if (activeOverrides.some((override) => override.effect === "ALLOW")) {
    return true;
  }

  return input.rolePermissionEnabled;
}
