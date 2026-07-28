/**
 * Single source of truth for status -> color.
 *
 * Every meaning-carrying color in the app flows through this map. Values are
 * Tailwind utility class strings built on the design tokens declared in
 * `src/app/globals.css` (@theme). Add a new status here, not inline in JSX.
 */

import type { CSSProperties } from "react";

export type StatusTone =
  // trial / project state
  | "planned"
  | "at-risk"
  | "missed"
  | "in-correction"
  | "completed"
  | "paused"
  // severity
  | "severity-low"
  | "severity-medium"
  | "severity-high"
  | "severity-critical";

type ToneClasses = {
  /** Background + text utility classes for a filled pill. */
  pill: string;
  /** Text-only utility class, for inline emphasis without a background. */
  text: string;
};

export const statusToneClasses: Record<StatusTone, ToneClasses> = {
  planned: { pill: "bg-status-planned-bg text-status-planned", text: "text-status-planned" },
  "at-risk": { pill: "bg-status-at-risk-bg text-status-at-risk", text: "text-status-at-risk" },
  missed: { pill: "bg-status-missed-bg text-status-missed", text: "text-status-missed" },
  "in-correction": {
    pill: "bg-status-in-correction-bg text-status-in-correction",
    text: "text-status-in-correction"
  },
  completed: { pill: "bg-status-completed-bg text-status-completed", text: "text-status-completed" },
  paused: { pill: "bg-status-paused-bg text-status-paused", text: "text-status-paused" },
  "severity-low": { pill: "bg-severity-low-bg text-severity-low", text: "text-severity-low" },
  "severity-medium": { pill: "bg-severity-medium-bg text-severity-medium", text: "text-severity-medium" },
  "severity-high": { pill: "bg-severity-high-bg text-severity-high", text: "text-severity-high" },
  "severity-critical": {
    pill: "bg-severity-critical-bg text-severity-critical",
    text: "text-severity-critical"
  }
};

/**
 * Human-readable status strings produced by the domain layer, mapped to a tone.
 * These match the display labels in `src/domain/mold-trial` (e.g. project
 * status labels, trial-limit warning states, severity labels).
 */
const statusKeyToTone: Record<string, StatusTone> = {
  // Project status labels
  Intake: "planned",
  Active: "planned",
  "Waiting Trial": "planned",
  Planned: "planned",
  "At Risk": "at-risk",
  "Auto Missed - Reason Required": "at-risk",
  "Trial Delayed": "missed",
  Delayed: "missed",
  Blocked: "missed",
  "In Correction": "in-correction",
  "Waiting Verification": "in-correction",
  Approved: "completed",
  Completed: "completed",
  Verified: "completed",
  Closed: "completed",
  "Over Limit": "missed",
  Paused: "paused",
  Cancelled: "paused",
  // Trial-limit warning states
  Healthy: "completed",
  "Near Limit": "at-risk",
  "At Limit": "at-risk",
  // Severity labels
  Low: "severity-low",
  Medium: "severity-medium",
  High: "severity-high",
  Critical: "severity-critical"
};

/** Resolve a domain status/severity label to a tone; falls back to neutral. */
export function toneForStatus(status: string): StatusTone {
  return statusKeyToTone[status] ?? "paused";
}

/**
 * The two CSS custom properties a "section hue" needs: a strong rule/dot colour
 * and its tint. Both resolve to the same `@theme` tokens the pill classes above
 * use — this is the variable form, for places that colour a border, a header
 * band, and a matching nav swatch from one tone (project-page dual coding).
 *
 * Tone names are the token suffixes by construction (`at-risk` ->
 * `--color-status-at-risk`, `severity-high` -> `--color-severity-high`), so no
 * second colour table can drift from this one.
 */
export function sectionHueVars(tone: StatusTone): CSSProperties {
  const token = tone.startsWith("severity-") ? tone : `status-${tone}`;

  // React writes `--*` keys through style.setProperty, but CSSProperties is a
  // closed type that deliberately models no custom properties — one assertion
  // here keeps every call site clean.
  return {
    "--section-hue": `var(--color-${token})`,
    "--section-hue-bg": `var(--color-${token}-bg)`
  } as CSSProperties;
}
