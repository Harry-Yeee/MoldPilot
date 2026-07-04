# Feature 0 — UI Foundation: shared components + design tokens

## Context (read first)

Repo: MoldPilot — internal mold trial tracker for an injection molding factory.
Stack: Next.js 16 App Router, TypeScript strict, Prisma 7 + PostgreSQL, Tailwind CSS v4, server components + server actions (no client state library). Path alias `@/`. Domain logic (pure, no IO) lives in `src/domain/mold-trial/`, server actions in `src/server/`, tests in `tests/domain/` run with `pnpm test` (node --test). Verify with `pnpm typecheck && pnpm test`.

Users: factory staff (PM, Marketing, Assembly, Injection, QC, Admin). Many prefer Chinese; `User.locale` is `EN_US | ZH_CN`. Several upcoming features will be used on phones on factory Wi-Fi.

Current UI: `src/app/page.tsx` (dashboard), `src/app/projects/[projectCode]/page.tsx` (project detail), `src/app/admin/page.tsx`, `src/app/login/page.tsx`. Styling is ad-hoc Tailwind per page. Success/error feedback flows through `?success=` / `?error=` query params.

## Goal

Create a small shared component library and design tokens so all upcoming features (mobile task page, photo capture, file attachments, QC reports) look consistent and work well on phones. This is foundation only — do not redesign existing workflows.

## Requirements

1. **Design tokens** in `src/app/globals.css` using Tailwind v4 `@theme`:
   - One brand/primary color (choose a calm industrial blue), neutral grays.
   - Semantic status colors used everywhere consistently:
     - trial/project state: planned=blue, at-risk=amber, missed/delayed=red, in-correction=violet, completed/approved=green, paused/cancelled=gray
     - severity: LOW=gray, MEDIUM=amber, HIGH=orange, CRITICAL=red
   - Consistent radius (e.g. `rounded-lg`) and one shadow level.
2. **Components** in `src/components/ui/` (server components where possible, `"use client"` only where needed):
   - `Button` — variants: primary, secondary, danger, ghost; sizes md and lg; `lg` min-height 44px (touch target).
   - `StatusBadge` — takes a semantic status key, renders colored pill. Single source of truth: a status→color map in `src/components/ui/status-colors.ts`.
   - `Card`, `SectionHeading`, `EmptyState` (icon + one-line message).
   - `FormField` wrapper (label, hint, error) + styled `TextInput`, `Select`, `DateInput`, `Textarea`. All inputs min-height 44px on touch.
   - `MessageBanner` — renders the existing `?success=` / `?error=` query-param pattern.
   - `BottomSheet` (client) — slides from bottom on small screens, centered modal ≥ md breakpoint. Will be used heavily by the mobile page later; keep the API simple (`open`, `onClose`, `title`, children).
3. **Bilingual scaffolding** (no i18n framework): `src/domain/mold-trial/labels.ts` with `type BilingualLabel = { en: string; zh: string }` and `pickLabel(label, locale)`. Convert the dashboard summary-card titles and main nav labels as the first usage. Do NOT translate the whole app in this task.
4. **Apply to two screens as proof** (visual refactor only, zero behavior change):
   - Dashboard (`src/app/page.tsx` + `mold-trial-list-table.tsx`): use Card/StatusBadge/MessageBanner/Button; make the project table collapse to stacked cards below `md` breakpoint.
   - Login page: use FormField/Button; must look clean at 375px width.

## UI quality bar

- Mobile-first: check every change at 375px width. No horizontal scrolling.
- Visual hierarchy: page title > section heading > card content. One primary action per view styled as primary button; everything else secondary/ghost.
- Status color is the ONLY place color carries meaning — don't decorate randomly.
- Dense data (dashboard table) stays dense on desktop; phone gets card layout, not a shrunken table.

## Out of scope

- Project detail page redesign (only swap in StatusBadge where statuses render).
- Any schema, server action, or permission change.
- Dark mode, animations beyond BottomSheet slide.

## Acceptance

- `pnpm typecheck && pnpm test` pass.
- Dashboard and login render correctly at 375px and 1280px.
- All new components exported from `src/components/ui/index.ts` with typed props, no `any`.
- A short usage note added at `src/components/ui/README.md` (component list + status color map) so later features follow it.
