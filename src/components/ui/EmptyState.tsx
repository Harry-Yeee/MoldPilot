import type { ReactNode } from "react";

export type EmptyStateProps = {
  /** Short one-line message. */
  message: ReactNode;
  /** Optional decorative icon (rendered aria-hidden). */
  icon?: ReactNode;
  className?: string;
};

export function EmptyState({ message, icon, className }: EmptyStateProps) {
  const classes = [
    "flex flex-col items-center justify-center gap-2 px-4 py-8 text-center text-neutral-600",
    className
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      {icon == null ? null : (
        <span aria-hidden="true" className="text-2xl text-neutral-500">
          {icon}
        </span>
      )}
      <p className="m-0 text-sm italic">{message}</p>
    </div>
  );
}
