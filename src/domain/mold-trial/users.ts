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
