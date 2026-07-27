export const factoryRoleCodes = [
  "GM",
  "PM",
  "MARKETING",
  "ASSEMBLY",
  "INJECTION",
  "QC",
  "DESIGN",
  "VIEWER"
] as const;

export type FactoryRoleCode = (typeof factoryRoleCodes)[number];
export type FactoryLocale = "EN_US" | "ZH_CN";
export type FactoryPermissionEffect = "ALLOW" | "DENY";

export type FactoryUser = {
  username: string;
  displayName: string;
  chineseName: string | null;
  roleCode: FactoryRoleCode;
  locale: FactoryLocale;
  active: boolean;
  kpiTeamCode: string | null;
  teamLeader: boolean;
};

export type FactoryPermissionException = {
  username: string;
  permissionCode: string;
  effect: FactoryPermissionEffect;
  reason: string;
  expiresOn: string | null;
};

export type FactoryUserRoster = {
  schemaVersion: 1;
  sourceWorkbook: string;
  sourceWorkbookSha256: string;
  reviewedAt: string;
  people: FactoryUser[];
  permissionExceptions: FactoryPermissionException[];
};

const roleKpiTeams: Record<FactoryRoleCode, readonly string[]> = {
  GM: [],
  PM: ["pm"],
  MARKETING: ["marketing"],
  ASSEMBLY: ["assembly-a", "assembly-b"],
  INJECTION: ["injection"],
  QC: ["qc"],
  DESIGN: ["design"],
  VIEWER: []
};

const leaderTeamCodes = [
  "marketing",
  "assembly-a",
  "assembly-b",
  "injection",
  "qc",
  "design"
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateFactoryUserRoster(input: unknown): FactoryUserRoster {
  const errors: string[] = [];
  if (!isRecord(input)) {
    throw new Error("Factory user roster must be a JSON object.");
  }

  if (input.schemaVersion !== 1) {
    errors.push("schemaVersion must be 1");
  }
  if (!nonEmptyString(input.sourceWorkbook)) {
    errors.push("sourceWorkbook is required");
  }
  if (
    typeof input.sourceWorkbookSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.sourceWorkbookSha256)
  ) {
    errors.push("sourceWorkbookSha256 must be a lowercase SHA-256 digest");
  }
  if (typeof input.reviewedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.reviewedAt)) {
    errors.push("reviewedAt must use YYYY-MM-DD");
  }
  if (!Array.isArray(input.people) || input.people.length === 0) {
    errors.push("people must contain at least one employee");
  }
  if (!Array.isArray(input.permissionExceptions)) {
    errors.push("permissionExceptions must be an array");
  }

  const people = Array.isArray(input.people) ? input.people : [];
  const usernames = new Set<string>();
  const parsedPeople: FactoryUser[] = [];

  people.forEach((value, index) => {
    const label = `people[${index}]`;
    if (!isRecord(value)) {
      errors.push(`${label} must be an object`);
      return;
    }

    const username = typeof value.username === "string" ? value.username.trim() : "";
    const displayName = typeof value.displayName === "string" ? value.displayName.trim() : "";
    const chineseName =
      value.chineseName == null
        ? null
        : typeof value.chineseName === "string" && value.chineseName.trim().length > 0
          ? value.chineseName.trim()
          : null;
    const roleCode = value.roleCode;
    const locale = value.locale;
    const active = value.active;
    const kpiTeamCode =
      value.kpiTeamCode == null
        ? null
        : typeof value.kpiTeamCode === "string" && value.kpiTeamCode.trim().length > 0
          ? value.kpiTeamCode.trim()
          : null;
    const teamLeader = value.teamLeader;

    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(username)) {
      errors.push(`${label}.username must be lowercase and contain no spaces`);
    } else if (username === "admin") {
      errors.push(`${label}.username cannot replace the protected Admin account`);
    } else if (usernames.has(username)) {
      errors.push(`${label}.username duplicates ${username}`);
    } else {
      usernames.add(username);
    }
    if (displayName.length === 0) {
      errors.push(`${label}.displayName is required`);
    }
    if (!factoryRoleCodes.includes(roleCode as FactoryRoleCode)) {
      errors.push(`${label}.roleCode is not assignable`);
    }
    if (locale !== "EN_US" && locale !== "ZH_CN") {
      errors.push(`${label}.locale must be EN_US or ZH_CN`);
    }
    if (typeof active !== "boolean") {
      errors.push(`${label}.active must be boolean`);
    }
    if (typeof teamLeader !== "boolean") {
      errors.push(`${label}.teamLeader must be boolean`);
    }

    if (factoryRoleCodes.includes(roleCode as FactoryRoleCode)) {
      const allowedTeams = roleKpiTeams[roleCode as FactoryRoleCode];
      if (allowedTeams.length === 0 && kpiTeamCode != null) {
        errors.push(`${label}.kpiTeamCode must be blank for ${roleCode}`);
      } else if (allowedTeams.length > 0 && !allowedTeams.includes(kpiTeamCode ?? "")) {
        errors.push(`${label}.kpiTeamCode does not match role ${roleCode}`);
      }
    }
    if (teamLeader === true && kpiTeamCode == null) {
      errors.push(`${label}.teamLeader requires a KPI team`);
    }
    if (teamLeader === true && active !== true) {
      errors.push(`${label}.teamLeader must be active`);
    }

    if (
      username.length > 0 &&
      displayName.length > 0 &&
      factoryRoleCodes.includes(roleCode as FactoryRoleCode) &&
      (locale === "EN_US" || locale === "ZH_CN") &&
      typeof active === "boolean" &&
      typeof teamLeader === "boolean"
    ) {
      parsedPeople.push({
        username,
        displayName,
        chineseName,
        roleCode: roleCode as FactoryRoleCode,
        locale,
        active,
        kpiTeamCode,
        teamLeader
      });
    }
  });

  for (const teamCode of leaderTeamCodes) {
    const members = parsedPeople.filter((person) => person.active && person.kpiTeamCode === teamCode);
    const leaders = members.filter((person) => person.teamLeader);
    if (members.length > 0 && leaders.length !== 1) {
      errors.push(`KPI team ${teamCode} must have exactly one active leader`);
    }
  }
  if (parsedPeople.some((person) => person.kpiTeamCode === "pm" && person.teamLeader)) {
    errors.push("KPI team pm uses individual scorecards and must not have a team leader");
  }

  const exceptions = Array.isArray(input.permissionExceptions) ? input.permissionExceptions : [];
  const exceptionKeys = new Set<string>();
  const parsedExceptions: FactoryPermissionException[] = [];
  exceptions.forEach((value, index) => {
    const label = `permissionExceptions[${index}]`;
    if (!isRecord(value)) {
      errors.push(`${label} must be an object`);
      return;
    }

    const username = typeof value.username === "string" ? value.username.trim() : "";
    const permissionCode =
      typeof value.permissionCode === "string" ? value.permissionCode.trim() : "";
    const effect = value.effect;
    const reason = typeof value.reason === "string" ? value.reason.trim() : "";
    const expiresOn =
      value.expiresOn == null
        ? null
        : typeof value.expiresOn === "string"
          ? value.expiresOn.trim()
          : "";
    const key = `${username}\u0000${permissionCode}`;

    if (!usernames.has(username)) {
      errors.push(`${label}.username must reference a roster employee`);
    }
    if (!/^[a-z0-9]+(?:[._][a-z0-9]+)+$/.test(permissionCode)) {
      errors.push(`${label}.permissionCode is invalid`);
    }
    if (effect !== "ALLOW" && effect !== "DENY") {
      errors.push(`${label}.effect must be ALLOW or DENY`);
    }
    if (reason.length === 0) {
      errors.push(`${label}.reason is required`);
    }
    if (expiresOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) {
      errors.push(`${label}.expiresOn must be blank or use YYYY-MM-DD`);
    }
    if (exceptionKeys.has(key)) {
      errors.push(`${label} duplicates ${username} / ${permissionCode}`);
    } else {
      exceptionKeys.add(key);
    }

    if (
      usernames.has(username) &&
      permissionCode.length > 0 &&
      (effect === "ALLOW" || effect === "DENY") &&
      reason.length > 0 &&
      (expiresOn === null || /^\d{4}-\d{2}-\d{2}$/.test(expiresOn))
    ) {
      parsedExceptions.push({
        username,
        permissionCode,
        effect,
        reason,
        expiresOn
      });
    }
  });

  if (errors.length > 0) {
    throw new Error(`Factory user roster validation failed:\n- ${errors.join("\n- ")}`);
  }

  return {
    schemaVersion: 1,
    sourceWorkbook: input.sourceWorkbook as string,
    sourceWorkbookSha256: input.sourceWorkbookSha256 as string,
    reviewedAt: input.reviewedAt as string,
    people: parsedPeople,
    permissionExceptions: parsedExceptions
  };
}
