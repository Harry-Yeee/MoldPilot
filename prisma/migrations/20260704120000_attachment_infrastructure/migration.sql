-- File attachment infrastructure: customer-safe visibility, soft delete, and
-- stored size/content-type metadata for the generic upload/download pipeline.

-- New visibility level for files Marketing may send to customers. Added on its
-- own ahead of the column changes below (none of which reference the new value),
-- mirroring the existing enum-extension migrations.
ALTER TYPE "FileVisibility" ADD VALUE IF NOT EXISTS 'CUSTOMER_SAFE';

-- New metadata + soft-delete columns. Existing rows (the process-sheet PDF
-- exports) receive safe backfills: an octet-stream content type and a zero size.
-- Soft-delete columns are nullable and default to NULL (not deleted).
ALTER TABLE "file_attachments"
  ADD COLUMN "content_type" TEXT NOT NULL DEFAULT 'application/octet-stream',
  ADD COLUMN "size_bytes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deleted_by_id" UUID;

CREATE INDEX "file_attachments_mold_trial_project_id_entity_type_idx"
  ON "file_attachments"("mold_trial_project_id", "entity_type");

ALTER TABLE "file_attachments"
  ADD CONSTRAINT "file_attachments_deleted_by_id_fkey"
  FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
