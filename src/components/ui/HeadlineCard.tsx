import type { ReactNode } from "react";

/**
 * Dashboard headline metric card (Bundle A — the loud dashboard). Wires count to
 * meaning using the existing semantic tokens: a "bad" metric (missed / critical)
 * tints itself red/critical only when its count is above zero; a zero renders as
 * quiet good news (green number on a neutral card). Informational metrics (e.g.
 * trials this week) always use a calm brand tint. Colors flow only through the
 * @theme tokens in globals.css — see src/components/ui/status-colors.ts.
 */
export type HeadlineCardTone = "missed" | "critical" | "info";

export type HeadlineCardProps = {
  count: number;
  label: string;
  tone: HeadlineCardTone;
  /** Optional destination — when set, the whole card is a link. */
  href?: string;
};

export function HeadlineCard({ count, label, tone, href }: HeadlineCardProps) {
  const isBad = tone === "missed" || tone === "critical";
  const active = isBad && count > 0;

  let cardClass = "flex flex-col gap-1 rounded-lg border px-4 py-3.5 no-underline hover:no-underline";
  let numberClass = "text-2xl font-bold leading-none tabular-nums";
  let labelClass = "text-sm font-medium";

  if (tone === "info") {
    cardClass += " border-brand-100 bg-brand-50";
    numberClass += " text-neutral-900";
    labelClass += " text-neutral-600";
  } else if (active && tone === "missed") {
    cardClass += " border-transparent bg-status-missed-bg";
    numberClass += " text-status-missed";
    labelClass += " text-status-missed";
  } else if (active && tone === "critical") {
    cardClass += " border-transparent bg-severity-critical-bg";
    numberClass += " text-severity-critical";
    labelClass += " text-severity-critical";
  } else {
    // Zero on a "bad" metric — green zero = good news, calm neutral card.
    cardClass += " border-neutral-300 bg-white";
    numberClass += " text-status-completed";
    labelClass += " text-neutral-600";
  }

  const content: ReactNode = (
    <>
      <span className={numberClass}>{count}</span>
      <span className={labelClass}>{label}</span>
    </>
  );

  if (href != null) {
    return (
      <a href={href} className={cardClass}>
        {content}
      </a>
    );
  }

  return <div className={cardClass}>{content}</div>;
}
