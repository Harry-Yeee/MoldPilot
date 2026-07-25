export type SeedManagedUserProfile = {
  displayName: string;
  chineseName: string | null;
  roleId: string;
  departmentGroupId: null;
  isDefaultAdmin: boolean;
  status: "ACTIVE";
};

export type SeededUserCredentials = {
  passwordHash: string;
  forcePasswordChange: boolean;
  passwordUpdatedAt: null;
  lastLoginAt: null;
};

export function seedManagedUserUpdate(
  profile: Omit<SeedManagedUserProfile, "departmentGroupId" | "status">
): SeedManagedUserProfile {
  return {
    ...profile,
    departmentGroupId: null,
    status: "ACTIVE"
  };
}

export function seededUserCreateCredentials(
  passwordHash: string,
  forcePasswordChange: boolean
): SeededUserCredentials {
  return {
    passwordHash,
    forcePasswordChange,
    passwordUpdatedAt: null,
    lastLoginAt: null
  };
}
