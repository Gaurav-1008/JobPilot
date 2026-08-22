import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-40 w-full resize-y rounded-md border border-input bg-card px-3 py-2",
      "text-sm leading-relaxed text-foreground shadow-sm transition-colors duration-150",
      "placeholder:text-muted-foreground hover:border-border-strong",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export { Textarea };
