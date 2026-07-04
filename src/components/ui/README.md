# UI foundation (`@/components/ui`)

Shared, phone-first component library and design tokens for MoldPilot. Import
everything from the barrel:

```ts
import { Button, StatusBadge, Card, FormField, TextInput, MessageBanner, BottomSheet } from "@/components/ui";
```

Design tokens live in `src/app/globals.css` under the Tailwind v4 `@theme`
block (brand blue, neutral grays, semantic status colors, `--radius-lg`,
`--shadow-card`). Components are styled with Tailwind utility classes that read
those tokens. Prefer these components over ad-hoc Tailwind or the legacy
semantic CSS classes for new work.

## Components

| Component | Type | Notes |
| --- | --- | --- |
| `Button` | server | `variant`: primary \| secondary \| danger \| ghost. `size`: md \| lg (lg = 44px touch target). |
| `StatusBadge` | server | Colored pill. Pass `status` (domain label) or an explicit `tone`. Color comes only from `status-colors.ts`. |
| `Card` / `CardBody` | server | `Card` is the bordered/shadowed surface; `CardBody` adds padding. |
| `SectionHeading` | server | `h2` row with optional `description` and `actions`. Pass `id` for `aria-labelledby`. |
| `EmptyState` | server | Icon + one-line message. |
| `FormField` | server | Wraps label + control + optional `hint`/`error`. |
| `TextInput` / `DateInput` / `Select` / `Textarea` | server | Styled controls, `min-h-11` (44px) touch target. |
| `MessageBanner` | server | Renders the `?success=` / `?error=` query-param flow. `variant`: success \| error \| info. |
| `BottomSheet` | client | Slides from the bottom below `md`, centered modal at `md`+. API: `open`, `onClose`, `title`, `children`. |

## Status color map (single source of truth)

Defined in `status-colors.ts` (`statusToneClasses`, `toneForStatus`). Status
color is the only place color carries meaning — do not decorate with color
elsewhere.

### Trial / project state

| Tone | Meaning | Domain labels |
| --- | --- | --- |
| `planned` | blue | Intake, Active, Waiting Trial, Planned |
| `at-risk` | amber | At Risk, Auto Missed, Near Limit, At Limit |
| `missed` | red | Trial Delayed, Delayed, Blocked, Over Limit |
| `in-correction` | violet | In Correction, Waiting Verification |
| `completed` | green | Approved, Completed, Verified, Closed, Healthy |
| `paused` | gray | Paused, Cancelled (and fallback) |

### Severity

| Tone | Meaning | Domain labels |
| --- | --- | --- |
| `severity-low` | gray | Low |
| `severity-medium` | amber | Medium |
| `severity-high` | orange | High |
| `severity-critical` | red | Critical |

## Bilingual labels

`src/domain/mold-trial/labels.ts` exports `BilingualLabel`, `pickLabel(label, locale)`
and label sets (`dashboardSummaryLabels`, `navLabels`). `locale` is the user's
`EN_US | ZH_CN`. This is a lightweight scaffold, separate from the full runtime
i18n layer in `src/i18n`.
