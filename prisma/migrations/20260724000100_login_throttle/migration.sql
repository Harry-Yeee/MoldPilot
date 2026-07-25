CREATE TYPE "LoginThrottleScope" AS ENUM ('ACCOUNT', 'SOURCE');

CREATE TABLE "login_throttle_buckets" (
    "id" UUID NOT NULL,
    "scope" "LoginThrottleScope" NOT NULL,
    "key_hash" VARCHAR(64) NOT NULL,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "first_failure_at" TIMESTAMP(3) NOT NULL,
    "last_failure_at" TIMESTAMP(3) NOT NULL,
    "blocked_until" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "login_throttle_buckets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "login_throttle_buckets_scope_key_hash_key"
ON "login_throttle_buckets"("scope", "key_hash");

CREATE INDEX "login_throttle_buckets_last_failure_at_idx"
ON "login_throttle_buckets"("last_failure_at");
