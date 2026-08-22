import * as React from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Page container and heading block.
 *
 * Before this, every screen wrote its own `mx-auto max-w-… px-6 py-10` and the
 * app used five different maximum widths across nine dashboard pages — so
 * moving between Tracker and Jobs shifted the left edge of the content and the
 * whole page appeared to jump. Widths are now a named prop with four values,
 * and picking one is a decision about content rather than about a number.
 *
 * Horizontal padding steps up with the viewport (16px → 24px) instead of
 * sitting at a fixed 24px, which on a 375px screen spent 13% of the width on
 * margins.
 */
const WIDTHS = {
  narrow: "max-w-2xl", // single-column forms: profile, opt-out, settings
  content: "max-w-3xl", // reading + one form: job detail, review, compose
  wide: "max-w-5xl", // lists and boards: jobs, tracker, outreach
  full: "max-w-6xl", // marketing
} as const;

export function Page({
  width = "content",
  className,
  children,
}: {
  width?: keyof typeof WIDTHS;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mx-auto px-4 py-8 sm:px-6 sm:py-10", WIDTHS[width], className)}>
      {children}
    </div>
  );
}

/**
 * Title, one-line description, and the page's own actions.
 *
 * `actions` wraps below the title on a narrow screen rather than squeezing
 * beside it — the tracker header carries three controls, and side-by-side they
 * were clipping at 375px.
 */
export function PageHeader({
  title,
  description,
  actions,
  back,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
  className?: string;
}) {
  return (
    <div className={cn("space-y-4", className)}>
      {back && (
        <Link
          href={back.href}
          className="-ml-1 inline-flex items-center gap-1 rounded-md py-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          {back.label}
        </Link>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            {title}
          </h1>
          {description && (
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>

        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
    </div>
  );
}

/** A titled block within a page. Keeps heading level and spacing consistent. */
export function Section({
  title,
  description,
  actions,
  className,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="space-y-1">
            {title && (
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {title}
              </h2>
            )}
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}
