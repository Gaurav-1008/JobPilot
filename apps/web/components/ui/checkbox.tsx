import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Native checkbox, sized up.
 *
 * `size-4` is the shadcn default and it is genuinely hard to hit on a phone —
 * which mattered here because the jobs board uses one per row to choose what to
 * fetch descriptions for. 18px drawn, with the label supplying the rest of the
 * target wherever one is wired up.
 *
 * `accent-color` rather than a custom-drawn box: it keeps the platform's own
 * checked/indeterminate/disabled rendering, including the focus ring the global
 * rule already provides.
 */
const Checkbox = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="checkbox"
    className={cn(
      "size-[18px] shrink-0 cursor-pointer rounded border-input",
      "accent-[color:var(--primary)] disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Checkbox.displayName = "Checkbox";

export { Checkbox };
