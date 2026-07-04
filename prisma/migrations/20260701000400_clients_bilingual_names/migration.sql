-- User bilingual display support.
ALTER TABLE "users" ADD COLUMN "chinese_name" TEXT;

-- Client workbook fields.
ALTER TABLE "customers" ADD COLUMN "country" TEXT;
ALTER TABLE "customers" ADD COLUMN "owner_user_id" UUID;

-- Existing Customer Master rows came from the previous migration/seed where short_name was optional.
UPDATE "customers"
SET "short_name" = COALESCE(NULLIF(btrim("short_name"), ''), NULLIF(btrim("display_name"), ''), "code")
WHERE "short_name" IS NULL OR btrim("short_name") = '';

ALTER TABLE "customers" ALTER COLUMN "short_name" SET NOT NULL;

CREATE INDEX "customers_owner_user_id_idx" ON "customers"("owner_user_id");

ALTER TABLE "customers" ADD CONSTRAINT "customers_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
