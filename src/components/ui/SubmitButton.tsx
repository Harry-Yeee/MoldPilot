"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./Button";

export type SubmitButtonProps = Omit<ButtonProps, "type">;

/**
 * A form submit button that disables itself and shows a subtle "…" busy suffix
 * while its form is pending (React's `useFormStatus`). This is the cheap half of
 * double-tap hardening: on laggy factory Wi-Fi the button visibly locks the
 * moment it is pressed, so the same server action can't be fired twice from one
 * form. The server-side guards remain the source of truth.
 *
 * When idle it renders exactly like a plain `<Button type="submit">` (same
 * variant/size/className pass through) — it only layers on the pending behaviour.
 * Must be rendered as a descendant of the `<form>` it submits, since
 * `useFormStatus` reads the status of the enclosing form.
 */
export function SubmitButton({ children, disabled, ...props }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={disabled === true || pending} aria-busy={pending || undefined} {...props}>
      {children}
      {pending ? " …" : null}
    </Button>
  );
}
