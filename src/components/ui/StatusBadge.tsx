import type { ReactNode } from "react";
import { statusToneClasses, toneForStatus, type StatusTone } from "./status-colors";

export type StatusBadgeProps = {
  /** Domain status/severity label (e.g. "At Risk", "Critical"). Resolved via the status->tone map. */
  status?: string;
  /** Explicit tone override; use when the caller already knows the tone. */
  tone?: StatusTone;
  /** Visible content; defaults to `status`. */
  children?: ReactNode;
  className?: string;
  /** Native tooltip text (e.g. the full explanation behind an abbreviated label). */
  title?: string;
  /** Accessible name override when the visible text is a shortened abbreviation. */
  ariaLabel?: string;
  /**
   * Allow the label to wrap onto multiple lines inside a fixed-width cell
   * instead of forcing the cell wider. Emits `whitespace-normal` in place of
   * the default `whitespace-nowrap` (only one is ever present, so there is no
   * utility-cascade tie to resolve).
   */
  wrap?: boolean;
};

export function StatusBadge({ status, tone, children, className, title, ariaLabel, wrap }: StatusBadgeProps) {
  const resolvedTone = tone ?? (status == null ? "paused" : toneForStatus(status));
  const classes = [
    "inline-flex items-center rounded-lg px-2.5 py-0.5 text-sm font-bold",
    wrap ? "whitespace-normal text-center leading-tight" : "whitespace-nowrap",
    statusToneClasses[resolvedTone].pill,
    className
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} title={title} aria-label={ariaLabel}>
      {children ?? status}
    </span>
  );
}
