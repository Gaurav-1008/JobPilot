import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Native <select>, styled.
 *
 * Native rather than a custom listbox on purpose: these carry filters and a
 * status field on a mobile-first product, and the platform picker beats
 * anything hand-rolled on a phone.
 *
 * `appearance-none` removes the UA arrow so the control can match the inputs
 * next to it, and the chevron is drawn back in — `pointer-events-none` so it
 * cannot swallow the click that opens the menu.
 */
const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <div className="relative inline-flex w-full">
    <select
      ref={ref}
      className={cn(
        "h-10 w-full cursor-pointer appearance-none rounded-md border border-input bg-card",
        "pl-3 pr-9 text-sm text-foreground shadow-sm transition-colors duration-150",
        "hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown
      aria-hidden="true"
      className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
    />
  </div>
));
Select.displayName = "Select";

export { Select };
