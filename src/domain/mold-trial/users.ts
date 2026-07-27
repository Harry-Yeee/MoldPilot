export type UserDisplayNameInput = {
  displayName: string;
  chineseName?: string | null;
  username?: string | null;
};

export type IssueOwnerUserOptionInput = UserDisplayNameInput & {
  role: {
    name: string;
  };
};

export function formatBilingualUserName(user: UserDisplayNameInput): string {
  const chineseName = user.chineseName?.trim();
  return chineseName == null || chineseName.length === 0 ? user.displayName : `${user.displayName} / ${chineseName}`;
}

export function formatBilingualUserOption(user: UserDisplayNameInput): string {
  const name = formatBilingualUserName(user);
  return user.username == null || user.username.length === 0 ? name : `${name} (${user.username})`;
}

export function formatIssueOwnerUserOption(user: IssueOwnerUserOptionInput): string {
  const roleName = user.role.name.trim() || "-";
  const displayName = user.displayName.trim() || "-";
  const chineseName = user.chineseName?.trim() || "-";

  return `${roleName} / ${displayName} / ${chineseName}`;
}

/**
 * Minimum shape needed to decide whether a user may receive a project's planning
 * PM slot. `status` is the Prisma `UserStatus` value, typed as a plain string so
 * this module stays free of Prisma imports.
 */
export type PlanningPmCandidate = {
  id: string;
  username: string;
  status: string;
};

export type PlanningPmSource = "PROJECT_PLANNING_PM" | "PROJECT_TECHNICAL_PM" | "FIRST_ACTIVE_PM";

export type PlanningPmResolution<TCandidate extends PlanningPmCandidate = PlanningPmCandidate> =
  | { ok: true; source: PlanningPmSource; user: TCandidate }
  | { ok: false; message: string };

export const noActivePlanningPmMessage = "No active PM exists / 没有可用的项目管理员";

/**
 * Who owns a project's planning PM slot when neither the form nor the acting
 * user names one.
 *
 * Order: whoever the project already has (planning PM first, then technical PM),
 * otherwise the first ACTIVE user holding role `pm` ordered by username — the
 * caller supplies that as `firstActivePm`. Archived candidates are skipped at
 * every step, matching the ACTIVE guard on explicitly named users. No username
 * is hardcoded, so the rule follows whatever roster the database was loaded
 * with (`pnpm prisma:bootstrap` / `pnpm prisma:seed`).
 *
 * Returns a failure instead of throwing so callers can turn it into their own
 * redirect/error style; the message is bilingual because it can reach the UI.
 */
export function resolveDefaultPlanningPm<TCandidate extends PlanningPmCandidate>(input: {
  projectPlanningPm?: TCandidate | null;
  projectTechnicalPm?: TCandidate | null;
  firstActivePm?: TCandidate | null;
}): PlanningPmResolution<TCandidate> {
  const ordered: readonly (readonly [PlanningPmSource, TCandidate | null | undefined])[] = [
    ["PROJECT_PLANNING_PM", input.projectPlanningPm],
    ["PROJECT_TECHNICAL_PM", input.projectTechnicalPm],
    ["FIRST_ACTIVE_PM", input.firstActivePm]
  ];

  for (const [source, candidate] of ordered) {
    if (candidate != null && candidate.status === "ACTIVE") {
      return { ok: true, source, user: candidate };
    }
  }

  return { ok: false, message: noActivePlanningPmMessage };
}

export type AccountIdentityLineInput = {
  displayName: string;
  username: string;
  roleName: string;
};

/**
 * Text for the account menu's secondary identity line under the display name.
 * Normally "{username} · {roleName}", but collapses to just the role when the
 * pieces are redundant (case-insensitively) so the admin account does not read
 * "admin · Admin" beneath a bold "Admin".
 */
export function formatAccountIdentityLine(user: AccountIdentityLineInput): string {
  const username = user.username.trim();
  const roleName = user.roleName.trim();
  const displayName = user.displayName.trim();

  const usernameMatchesRole = username.toLowerCase() === roleName.toLowerCase();
  const displayNameIsRedundant =
    displayName.toLowerCase() === username.toLowerCase() && displayName.toLowerCase() === roleName.toLowerCase();

  if (usernameMatchesRole || displayNameIsRedundant) {
    return roleName;
  }

  return `${username} · ${roleName}`;
}
