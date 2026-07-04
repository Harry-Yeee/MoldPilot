ALTER TABLE "users"
  ADD COLUMN "password_hash" TEXT,
  ADD COLUMN "force_password_change" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "password_updated_at" TIMESTAMP(3),
  ADD COLUMN "last_login_at" TIMESTAMP(3);
