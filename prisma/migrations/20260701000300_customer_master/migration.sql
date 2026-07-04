-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "short_name" TEXT,
    "aliases" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_code_key" ON "customers"("code");

-- CreateIndex
CREATE INDEX "customers_active_idx" ON "customers"("active");

-- AlterTable
ALTER TABLE "mold_trial_projects" ADD COLUMN "customer_id" UUID;

-- Backfill one Customer Master row per existing customer_code snapshot.
INSERT INTO "customers" (
    "id",
    "code",
    "display_name",
    "active",
    "created_at",
    "updated_at"
)
SELECT
    gen_random_uuid(),
    "customer_code",
    "customer_code",
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT "customer_code"
    FROM "mold_trial_projects"
    WHERE "customer_code" IS NOT NULL
      AND btrim("customer_code") <> ''
) AS existing_customer_codes
ON CONFLICT ("code") DO NOTHING;

UPDATE "mold_trial_projects"
SET "customer_id" = "customers"."id"
FROM "customers"
WHERE "mold_trial_projects"."customer_code" = "customers"."code";

ALTER TABLE "mold_trial_projects" ALTER COLUMN "customer_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "mold_trial_projects_customer_id_idx" ON "mold_trial_projects"("customer_id");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mold_trial_projects" ADD CONSTRAINT "mold_trial_projects_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
