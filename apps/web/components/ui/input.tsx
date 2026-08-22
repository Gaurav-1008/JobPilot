import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Text input.
 *
 * Replaces the `mt-1 w-full rounded border px-3 py-2` that was pasted into
 * roughly thirty labels across the app. That string has three problems the
 * repetition made invisible: `border` with no colour picks up whatever the
 * global `*` rule set rather than the input-specific token, `py-2` gives a
 * 38px control, and none of them declared a background — so on a dark theme
 * they inherited the page and the field boundary vanished.
 */
const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm",
      "transition-colors duration-150 placeholder:text-muted-foreground",
      "hover:border-border-strong",
      "disabled:cursor-not-allowed disabled:opacity-50",
      // File inputs are styled through their button; without this the segment
      // renders with the UA's own font and sits off the baseline.
      "file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export { Input };
