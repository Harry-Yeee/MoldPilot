# Feature 1 — File Attachment Infrastructure

## Context (read first)

Repo: MoldPilot — internal mold trial tracker. Next.js 16 App Router, TypeScript strict, Prisma 7 + PostgreSQL, Tailwind v4. Path alias `@/`. Pure domain logic in `src/domain/mold-trial/`, server actions in `src/server/`, tests in `tests/domain/` (node --test). Every mutation writes an `ActivityLog` row (see existing patterns in `src/server/mold-trial-actions.ts`). Permissions: codes defined in `src/domain/mold-trial/permission-policy.ts`, checked via `getEffectivePermissionCodes` (`src/server/permissions.ts`); UI gating via `hasPermissionCode` (`src/app/permission-ui.tsx`). Auth: `getCurrentUser()` from `src/server/current-user.ts`. Shared UI components in `src/components/ui/` (see its README).

This app runs on a single Mac on the factory LAN. **No cloud storage, no network dependencies at runtime.**

## Current state

`prisma/schema.prisma` already has a `FileAttachment` model (entityType, entityId, fileName, fileType, storageKey, visibility, uploadedById) with enums `AttachmentEntityType`, `FileType` (TRIAL_PHOTO, QC_REPORT, ...), `FileVisibility` (INTERNAL, TECHNICAL, RESTRICTED). Nothing uploads or serves files yet, except the process-sheet PDF export which writes to disk directly in `src/server/mold-trial-actions.ts`.

## Goal

Generic, permission-checked file upload/storage/download used by two upcoming features (trial photos, QC measurement reports). Build the plumbing + one visible integration point.

## Requirements

1. **Schema migration** (only these changes):
   - Add `CUSTOMER_SAFE` to `FileVisibility` (files Marketing may send to customers).
   - Add `deletedAt DateTime?` and `deletedById String?` to `FileAttachment` (soft delete; never hard-delete files).
   - Add `sizeBytes Int` and `contentType String` to `FileAttachment`.
2. **Storage** in `src/server/attachment-storage.ts`:
   - Root dir from `MOLDPILOT_STORAGE_DIR` env (default `./storage/uploads`, add to `.gitignore` and `.env.example`).
   - `storageKey` = generated UUID + safe extension derived from validated content type. Never use the client filename for the path. Resolve and verify the final path stays inside the root dir.
3. **Validation** as pure functions in `src/domain/mold-trial/attachments.ts` (unit-testable):
   - Allowed types per FileType: TRIAL_PHOTO → jpeg/png/webp/heic, ≤ 10 MB. QC_REPORT / CUSTOMER_REPORT_PDF / OTHER docs → pdf/xlsx/xls/docx/csv, ≤ 25 MB.
   - Filename sanitization for display (strip path separators/control chars, cap length).
   - Access rule: `canDownloadAttachment(visibility, permissionCodes)` — INTERNAL/TECHNICAL/RESTRICTED need `attachment.download.internal`; CUSTOMER_SAFE additionally allowed with `attachment.download.customer_safe` (Marketing gets this one).
4. **Permissions**: add codes to the policy + seed: `attachment.upload`, `attachment.delete`, `attachment.download.internal`, `attachment.download.customer_safe`. Sensible role defaults: PM/Technical/QC/Assembly/Injection/Admin can upload + download internal; Marketing can upload + download customer_safe; Viewer downloads internal only; only Admin and the original uploader may delete.
5. **Server actions** in `src/server/attachment-actions.ts`:
   - `uploadAttachment(formData)` — fields: projectId, entityType, entityId, fileType, visibility, file. Validate entity belongs to the project. Write file, create row, ActivityLog entry.
   - `deleteAttachment(formData)` — soft delete + ActivityLog. Uploader-or-admin rule enforced server-side.
6. **Download route** `src/app/api/attachments/[id]/route.ts` (GET):
   - `getCurrentUser()` required; 404 if soft-deleted; enforce `canDownloadAttachment`.
   - Stream from disk with stored `contentType`; images `Content-Disposition: inline`, everything else `attachment; filename="<sanitized>"`.
7. **UI** using `src/components/ui/`:
   - `AttachmentList` (name, type badge, uploader, date, size, download link, delete button when permitted) and `AttachmentUploader` (file input + fileType/visibility selects where relevant) in `src/components/attachments/`.
   - Integrate one place now: project detail page gets a "Files" section for project-level attachments (entityType MOLD_TRIAL_PROJECT). Keep it collapsed by default to avoid cluttering the page.

## Out of scope

- Photo capture UI, image resizing (feature 3). QC report workflow (feature 4). Cloud storage, virus scanning, thumbnails/image processing on the server.

## Acceptance

- `pnpm typecheck && pnpm test` pass; new domain tests cover: type/size validation per FileType, filename sanitization, `canDownloadAttachment` for each visibility × permission combo.
- Upload a PDF and a photo on project detail as admin; download both; Marketing account can download CUSTOMER_SAFE but not RESTRICTED; Viewer cannot see upload/delete controls AND the server actions reject it (test permission server-side, not just UI).
- Path traversal attempt in filename cannot escape the storage dir (unit test the key/path logic).
