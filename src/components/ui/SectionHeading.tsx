import type { ReactNode } from "react";

export type SectionHeadingProps = {
  children: ReactNode;
  /** Optional id so an owning region can reference it via aria-labelledby. */
  id?: string;
  /** Optional secondary content (subtext) shown under the heading. */
  description?: ReactNode;
  /** Optional action(s) shown at the end of the heading row. */
  actions?: ReactNode;
  className?: string;
};

export function SectionHeading({ children, id, description, actions, className }: SectionHeadingProps) {
  const classes = [
    "flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-4 py-4 sm:px-[18px]",
    className
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <div className="min-w-0">
        <h2 id={id} className="text-[1.15rem] leading-tight">
          {children}
        </h2>
        {description == null ? null : <p className="mt-1.5 text-sm text-neutral-600">{description}</p>}
      </div>
      {actions == null ? null : <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
