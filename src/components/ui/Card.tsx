import type { ElementType, ReactNode } from "react";

export type CardProps = {
  children: ReactNode;
  /** Render element; defaults to a section. */
  as?: ElementType;
  className?: string;
  "aria-labelledby"?: string;
  "aria-label"?: string;
};

export function Card({ children, as, className, ...props }: CardProps) {
  const Element = as ?? "section";
  const classes = ["rounded-lg border border-neutral-300 bg-white shadow-card", className]
    .filter(Boolean)
    .join(" ");

  return (
    <Element className={classes} {...props}>
      {children}
    </Element>
  );
}

export type CardBodyProps = {
  children: ReactNode;
  className?: string;
};

/** Padded region inside a Card. */
export function CardBody({ children, className }: CardBodyProps) {
  const classes = ["p-4 sm:p-[18px]", className].filter(Boolean).join(" ");
  return <div className={classes}>{children}</div>;
}
