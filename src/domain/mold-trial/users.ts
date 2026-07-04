export type UserDisplayNameInput = {
  displayName: string;
  chineseName?: string | null;
  username?: string | null;
};

export function formatBilingualUserName(user: UserDisplayNameInput): string {
  const chineseName = user.chineseName?.trim();
  return chineseName == null || chineseName.length === 0 ? user.displayName : `${user.displayName} / ${chineseName}`;
}

export function formatBilingualUserOption(user: UserDisplayNameInput): string {
  const name = formatBilingualUserName(user);
  return user.username == null || user.username.length === 0 ? name : `${name} (${user.username})`;
}
