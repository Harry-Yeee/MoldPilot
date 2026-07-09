# Feature 3 — Trial Issue Photos (desktop)

> **Scope decision (2026-07-04):** ALL creation happens on desktop. The phone (`/me`) is strictly for viewing and completing assigned items. This feature adds photos to the DESKTOP issue forms only. The mobile camera-capture flow described in earlier drafts is deferred — do not build any /me or mobile issue-creation UI.

## Context (read first)

Repo: MoldPilot — internal mold trial tracker. Next.js 16 App Router, TypeScript strict, Prisma 7 + PostgreSQL, Tailwind v4. Path alias `@/`. Domain logic in `src/domain/mold-trial/`, server actions in `src/server/`, tests in `tests/domain/` (node --test). Shared UI in `src/components/ui/`.

**Depends on already-merged feature** (verify it exists before starting):
- Attachment infrastructure: `src/server/attachment-actions.ts` (`uploadAttachment`), `src/domain/mold-trial/attachments.ts` (validation), download route `/api/attachments/[id]`, components in `src/components/attachments/`. TRIAL_PHOTO rules: jpeg/png/webp/heic, ≤10 MB, entityType TRIAL_ISSUE or TRIAL_EVENT.

Issue creation currently lives in the project detail page (`src/app/projects/[projectCode]/`) via server actions in `src/server/mold-trial-actions.ts`. Issues can reference an affected part (`MoldTrialPart`) and a found-at trial event.

## Goal

When PM (or anyone reporting an issue) files or edits an issue on the desktop project page, they can attach photos of the defective part (taken on a phone/camera and transferred, or picked from disk). Photos are viewable wherever the issue is shown.

## Requirements

1. **`ImageCaptureField`** client component in `src/components/attachments/image-capture-field.tsx`:
   - `<input type="file" accept="image/*" multiple>` styled as a clear "Add photos / 添加照片" button.
   - Client-side downscale before upload: longest side ≤ 1600px, re-encode JPEG quality 0.8 via canvas (HEIC: let the browser's canvas conversion handle it; if decode fails, upload original and rely on the 10 MB cap).
   - Thumbnail strip of pending photos with per-photo remove button; count indicator; disabled state while uploading.
2. **Desktop issue form**: add `ImageCaptureField` to the existing issue create/edit UI on the project detail page. Submission = existing create/update-issue server action + attachment uploads (extend the action to accept files; keep issue creation transactional — if issue creation fails, no orphan files; if a photo upload fails, the issue still saves and the form reports which photos to retry).
3. **Display**:
   - Issue rows (project detail + /me "My open issues") show a small photo-count chip when photos exist.
   - Issue detail/expanded view: thumbnail grid (lazy-loaded `<img>` from the download route, inline disposition); tap/click opens the shared `Lightbox` component (`src/components/attachments/Lightbox.tsx`) — issue galleries pass their own image array.
4. **Permissions**: reuse `attachment.upload` — anyone who can create/edit an issue and has upload permission can attach photos. Deleting a photo follows attachment delete rules.

## UI quality bar

- Show per-photo upload progress or at minimum a busy state; never let the user think a click did nothing.
- Photos are evidence, not decoration — show upload date + uploader under each thumbnail in the detail view.
- Thumbnails ≥ 64px with an obvious ✕ to remove before submitting.

## Out of scope

- ANY mobile/phone/`/me` creation or capture UI (deferred by owner decision — phone stays view-and-complete only). Drawing/annotation/markup on photos. Video. Server-side thumbnail generation (browser downscaling makes files small enough). Photos on entities other than TrialIssue/TrialEvent.

## Acceptance

- `pnpm typecheck && pnpm test` pass; domain tests for any new pure logic (e.g. pending-photo state reducer if extracted).
- Desktop walkthrough: create an issue on project detail with 2 photos attached; thumbnails render under the issue; full-size opens correctly; the photo-count chip shows on the issue row (and read-only on /me).
- A 12 MB camera photo is downscaled client-side and uploads successfully; a .txt file renamed to .jpg is rejected server-side.
- Issue creation with zero photos still works everywhere (photos always optional).
