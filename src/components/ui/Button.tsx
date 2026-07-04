import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg border font-bold no-underline transition-colors " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 " +
  "disabled:cursor-not-allowed disabled:opacity-60";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "border-brand-600 bg-brand-600 text-white hover:bg-brand-700 hover:border-brand-700",
  secondary: "border-neutral-400 bg-white text-brand-600 hover:bg-neutral-100",
  danger: "border-status-missed bg-status-missed text-white hover:opacity-90",
  ghost: "border-transparent bg-transparent text-brand-600 hover:bg-neutral-100"
};

const sizeClasses: Record<ButtonSize, string> = {
  md: "min-h-9 px-3.5 text-sm",
  // lg guarantees a 44px touch target
  lg: "min-h-11 px-5 text-base"
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  className,
  children,
  ...props
}: ButtonProps) {
  const classes = [base, variantClasses[variant], sizeClasses[size], className].filter(Boolean).join(" ");

  return (
    // eslint-disable-next-line react/button-has-type
    <button type={type} className={classes} {...props}>
      {children}
    </button>
  );
}
