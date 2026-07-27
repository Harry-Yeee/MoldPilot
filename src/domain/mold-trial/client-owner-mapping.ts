export const clientOwnerUsernameByChineseName = {
  "刘婉霞": "liu.wanxia",
  "周娟娥": "zhou.juane",
  "彭利满": "peng.liman"
} as const;

export type ClientOwnerChineseName = keyof typeof clientOwnerUsernameByChineseName;
