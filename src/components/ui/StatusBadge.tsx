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
};

export function StatusBadge({ status, tone, children, className }: StatusBadgeProps) {
  const resolvedTone = tone ?? (status == null ? "paused" : toneForStatus(status));
  const classes = [
    "inline-flex items-center rounded-lg px-2.5 py-0.5 text-sm font-bold whitespace-nowrap",
    statusToneClasses[resolvedTone].pill,
    className
  ]
    .filter(Boolean)
    .join(" ");

  return <span className={classes}>{children ?? status}</span>;
}
