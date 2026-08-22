import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  OctagonAlert,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Every notice on the app: errors, warnings, confirmations, context.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS COMPONENT EXISTS BECAUSE THE HAND-ROLLED VERSION WAS UNREADABLE IN DARK
 * MODE. The pattern was `border-red-300 bg-red-50 text-red-900` — a fixed pale
 * background with fixed dark text. On a dark theme that is a white card in the
 * middle of a dark page, and after the surrounding foreground colour is
 * inherited anywhere it is dark-on-dark. The screens carrying it were the
 * outreach guardrail panels: the "these claims are not supported by your
 * resume" block, which gates a real email to a real person.
 *
 * Tone maps to a token triple that follows the theme, so the same markup is
 * legible in both.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `role` IS A PROP AND HAS NO DEFAULT-BY-TONE. A danger alert is not
 * automatically assertive: the outreach screen deliberately uses `alert` for
 * blocking findings and `status` for advisory flags, because making every soft
 * flag interrupt is how a user learns to tune out the region that carries the
 * blocking ones. The caller knows which it is; this component does not.
 */
const alertVariants = cva(
  "rounded-lg border p-4 text-sm [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-2",
  {
    variants: {
      tone: {
        neutral: "border-border bg-elevated text-foreground",
        info: "border-info-border bg-info-soft text-info",
        success: "border-success-border bg-success-soft text-success",
        warning: "border-warning-border bg-warning-soft text-warning",
        danger: "border-danger-border bg-danger-soft text-danger",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

const TONE_ICON: Record<string, LucideIcon> = {
  neutral: Info,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: OctagonAlert,
};

export interface AlertProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title">,
    VariantProps<typeof alertVariants> {
  title?: React.ReactNode;
  /** Pass `false` for a compact inline notice with no icon column. */
  icon?: boolean;
}

export function Alert({
  className,
  tone = "neutral",
  title,
  icon = true,
  children,
  ...props
}: AlertProps) {
  const Icon = TONE_ICON[tone ?? "neutral"];

  return (
    <div className={cn(alertVariants({ tone }), className)} {...props}>
      <div className="flex gap-3">
        {icon && <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
        <div className="min-w-0 flex-1 space-y-1.5">
          {title && <p className="font-semibold leading-snug">{title}</p>}
          {/*
           * Body copy steps down to the muted foreground only on the neutral
           * tone. On a coloured tone it stays in the tone colour: muted grey on
           * a red-tinted panel is the gray-on-gray pairing, and it lands around
           * 2.5:1 against the soft background.
           */}
          {children && (
            <div
              className={cn(
                "leading-relaxed",
                tone === "neutral" && "text-muted-foreground",
              )}
            >
              {children}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
