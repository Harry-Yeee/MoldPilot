import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes
} from "react";

/** Shared control chrome. min-h-11 (44px) keeps a comfortable touch target. */
const controlBase =
  "w-full min-h-11 rounded-lg border border-neutral-400 bg-white px-2.5 text-neutral-900 font-normal " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand-500 " +
  "disabled:bg-neutral-100 disabled:text-neutral-600";

function withBase(className: string | undefined, extra = ""): string {
  return [controlBase, extra, className].filter(Boolean).join(" ");
}

export type FormFieldProps = {
  label: ReactNode;
  /** Associates the label with the control. Pass the same value as the control id. */
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function FormField({ label, htmlFor, hint, error, children, className }: FormFieldProps) {
  const classes = ["grid gap-1.5 text-[0.8125rem] font-bold text-neutral-600", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint == null ? null : <p className="m-0 font-bold text-neutral-500">{hint}</p>}
      {error == null ? null : (
        <p className="m-0 font-bold text-status-missed" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

export function TextInput({ className, type = "text", ...props }: TextInputProps) {
  return <input type={type} className={withBase(className)} {...props} />;
}

export type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export function DateInput({ className, ...props }: DateInputProps) {
  return <input type="date" className={withBase(className)} {...props} />;
}

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  children: ReactNode;
};

export function Select({ className, children, ...props }: SelectProps) {
  return (
    <select className={withBase(className)} {...props}>
      {children}
    </select>
  );
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, ...props }: TextareaProps) {
  return <textarea className={withBase(className, "py-2 resize-y")} {...props} />;
}
