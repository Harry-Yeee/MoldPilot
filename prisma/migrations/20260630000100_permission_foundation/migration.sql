CREATE TYPE "UserPermissionOverrideEffect" AS ENUM ('ALLOW', 'DENY');

ALTER TABLE "roles"
  ADD COLUMN "system_role" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "permissions" (
  "id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "process_group" TEXT NOT NULL,
  "description" TEXT,
  "is_system_permission" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

CREATE TABLE "role_permissions" (
  "id" UUID NOT NULL,
  "role_id" UUID NOT NULL,
  "permission_id" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "updated_by_id" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "role_permissions_role_id_permission_id_key"
  ON "role_permissions"("role_id", "permission_id");

CREATE INDEX "role_permissions_permission_id_idx"
  ON "role_permissions"("permission_id");

ALTER TABLE "role_permissions"
  ADD CONSTRAINT "role_permissions_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "role_permissions_permission_id_fkey"
    FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "role_permissions_updated_by_id_fkey"
    FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "user_permission_overrides" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "permission_id" UUID NOT NULL,
  "effect" "UserPermissionOverrideEffect" NOT NULL,
  "reason" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3),
  "updated_by_id" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_permission_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_permission_overrides_user_id_permission_id_key"
  ON "user_permission_overrides"("user_id", "permission_id");

CREATE INDEX "user_permission_overrides_permission_id_idx"
  ON "user_permission_overrides"("permission_id");

ALTER TABLE "user_permission_overrides"
  ADD CONSTRAINT "user_permission_overrides_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "user_permission_overrides_permission_id_fkey"
    FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "user_permission_overrides_updated_by_id_fkey"
    FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
