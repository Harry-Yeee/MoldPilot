export const clientOwnerUsernameByChineseName = {
  "刘婉霞": "anna",
  "周娟娥": "zoe",
  "彭利满": "peng"
} as const;

export type ClientOwnerChineseName = keyof typeof clientOwnerUsernameByChineseName;
