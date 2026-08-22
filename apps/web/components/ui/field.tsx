import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Label + control + hint + error, wired together.
 *
 * The wiring is the point. Every form on this app hand-built the same shape as
 * `<label><span>Name</span><input/></label>`, which associates the label but
 * leaves hint and error text floating as unrelated siblings — a screen reader
 * announces "Background, edit text" and none of the explanation of what that
 * field is for, on a field whose *whole problem* is that people paste a bio
 * into it.
 *
 * So this generates ids and points `aria-describedby` at whichever of hint and
 * error actually rendered. `htmlFor` needs a real id on the control, which the
 * caller passes through `children` — hence `renderControl` taking the id back
 * rather than the component guessing.
 */
export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: (props: {
    id: string;
    "aria-describedby": string | undefined;
    "aria-invalid": true | undefined;
  }) => React.ReactNode;
}) {
  const id = React.useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
        {required && (
          <span className="ml-1 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>

      {hint && (
        <p id={hintId} className="text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      )}

      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}

      {/* role="alert" so a validation failure is announced when it appears,
          not only when the user next tabs onto the field. */}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
