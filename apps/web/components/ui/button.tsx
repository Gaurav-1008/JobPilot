import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The one button.
 *
 * Two properties are baked in rather than left to call sites, because call
 * sites got them wrong consistently:
 *
 *   TOUCH HEIGHT. Every size clears 40px, and `sm` — the size that used to be
 *   hand-rolled as `px-3 py-1` all over the dashboard — is 36px with the tap
 *   target padded out to 44px via a pseudo-element. Those hand-rolled controls
 *   were ~26px tall, well under the 44px minimum, and they were the *primary*
 *   actions on the jobs and outreach screens.
 *
 *   `cursor-pointer`. Tailwind's preflight sets `cursor: default` on <button>,
 *   so a button only looks clickable if something says so.
 *
 * `loading` is a prop rather than a spinner each caller renders itself: it also
 * sets `disabled` and `aria-busy`, and those three were routinely out of step —
 * a button that said "Sending…" while remaining pressable is a double send.
 */
const buttonVariants = cva(
  [
    "relative inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap",
    "rounded-md text-sm font-medium transition-[background-color,color,border-color,opacity] duration-150",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover",
        outline:
          "border border-border-strong bg-card text-foreground shadow-sm hover:bg-muted",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        secondary: "bg-muted text-foreground hover:bg-border",
        // Destructive is bordered rather than filled: a solid red block reads
        // as "the thing to press" in a row of neutral controls, which is the
        // opposite of what a delete should look like.
        destructive:
          "border border-danger-border bg-danger-soft text-danger hover:bg-danger hover:text-card",
        link: "text-link underline decoration-link/40 underline-offset-4 hover:decoration-link",
      },
      size: {
        default: "h-10 px-4 py-2",
        // Drawn at 36px, tapped at 44px. The pseudo-element extends the hit
        // area 4px past each edge without moving the box, so a dense filter
        // row still looks dense and is still reachable with a thumb. Scoped to
        // the small sizes because the others already clear the minimum, and an
        // invisible overlay on every button in the app is a good way to have
        // one of them swallow a neighbour's click.
        sm: "h-9 rounded-md px-3 after:absolute after:left-0 after:top-1/2 after:h-11 after:w-full after:-translate-y-1/2 after:content-['']",
        lg: "h-11 rounded-md px-6 text-base",
        icon: "size-10 after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Shows a spinner, disables the button, and marks it busy — all three. */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

export { Button, buttonVariants };
