import type { ReactNode } from "react";

export type MessageBannerVariant = "success" | "error" | "info";

const variantClasses: Record<MessageBannerVariant, string> = {
  success: "border-[#9ad4b0] bg-[#edf9f1] text-[#165c37]",
  error: "border-[#f0a3a3] bg-[#fff0f0] text-[#8f1f1f]",
  info: "border-[#f0c36a] bg-[#fff8e8] text-[#6c4c07]"
};

const roleForVariant: Record<MessageBannerVariant, "alert" | "status"> = {
  success: "status",
  error: "alert",
  info: "status"
};

export type MessageBannerProps = {
  variant: MessageBannerVariant;
  /** Bold lead-in (e.g. "Saved", "Action failed"). */
  title: ReactNode;
  /** Detail message, typically the raw `?success=` / `?error=` query value. */
  children?: ReactNode;
  className?: string;
};

export function MessageBanner({ variant, title, children, className }: MessageBannerProps) {
  const classes = [
    "grid gap-1 rounded-lg border px-4 py-3.5",
    variantClasses[variant],
    className
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} role={roleForVariant[variant]}>
      <strong>{title}</strong>
      {children == null ? null : <span className="[overflow-wrap:anywhere]">{children}</span>}
    </div>
  );
}
