/**
 * The four renderings every list needs (P7.1.1, P7.1.2, P7.1.3).
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EC-P7-01 — LOADING AND EMPTY MUST NOT SHARE A COMPONENT.
 *
 * The natural way to write a list is `{items.length === 0 && <Empty />}`, and
 * it is wrong in a way that only shows up on a bad connection: while the query
 * is in flight `items` is also empty, so a slow request renders "No jobs yet —
 * run a search" for two seconds before the jobs appear. The user has been told
 * something false about their own data, and if the request is slow enough they
 * act on it and start a second search.
 *
 * Sharing one component with an `isLoading` prop does not fix it either — it
 * just moves the mistake somewhere it is easier to get wrong later. So these
 * are four separate exports with no shared branch, and a list picks exactly one.
 *
 * EC-P7-02 — "nothing here" and "nothing MATCHES" are different sentences with
 * different next actions. `ListEmpty` says run a search; `ListNoMatches` says
 * clear the filters, and offers a control that does it. Showing the first when
 * the second is true tells a user their data is gone when it is merely hidden,
 * which is the more alarming of the two errors.
 * ═════════════════════════════════════════════════════════════════════════
 */

import type { LucideIcon } from "lucide-react";
import { FilterX, Inbox } from "lucide-react";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * P7.1.2 — a skeleton, not a spinner.
 *
 * A skeleton in the shape of the eventual content says "rows are coming and
 * roughly this many"; a spinner says "something is happening somewhere". The
 * difference matters most on the screens where the wait is longest.
 *
 * `aria-busy` with a label, because the visual metaphor conveys nothing to a
 * screen reader — without it the region is simply silent while it loads.
 */
export function ListLoading({
  rows = 3,
  label = "Loading",
  className,
}: {
  rows?: number;
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className={cn("space-y-2", className)}
    >
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-lg border border-border bg-card p-4"
        >
          {/* Shaped like a row rather than a plain bar: a score cell, two lines
              of text, and a trailing meta column. The point of a skeleton is
              that the layout does not jump when the data lands. */}
          <Skeleton className="size-10 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="hidden h-3 w-16 shrink-0 sm:block" />
        </div>
      ))}
    </div>
  );
}

/** Shared frame for the two "there is nothing to show" states. */
function EmptyFrame({
  icon: Icon,
  title,
  detail,
  children,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border-strong bg-card/50 px-6 py-12 text-center">
      <span
        aria-hidden="true"
        className="mx-auto grid size-11 place-items-center rounded-full bg-muted text-muted-foreground"
      >
        <Icon className="size-5" />
      </span>
      <p className="mt-4 font-medium">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
        {detail}
      </p>
      {children && <div className="mt-5 flex justify-center">{children}</div>}
    </div>
  );
}

/**
 * Nothing exists yet. The copy must name the ONE action that changes that —
 * an empty state without a next step is a dead end, and P5 says degrade, never
 * dead-end.
 */
export function ListEmpty({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: { label: string; href: string };
}) {
  return (
    <EmptyFrame icon={Inbox} title={title} detail={detail}>
      {action && (
        <Link href={action.href} className={buttonVariants()}>
          {action.label}
        </Link>
      )}
    </EmptyFrame>
  );
}

/**
 * EC-P7-02 — data exists, the filters hide it.
 *
 * Deliberately reports the total, because "0 of 47" is the fact that tells the
 * user their data is fine and the filter is wrong. The clear control is part of
 * the state rather than something to hunt for above.
 */
export function ListNoMatches({
  total,
  noun,
  onClear,
}: {
  total: number;
  noun: string;
  onClear: () => void;
}) {
  return (
    <EmptyFrame
      icon={FilterX}
      title={`None of your ${total} ${noun} match these filters`}
      detail="Nothing has been deleted — the filters are just narrower than the data."
    >
      <Button variant="outline" onClick={onClear}>
        Clear filters
      </Button>
    </EmptyFrame>
  );
}

/**
 * The request failed.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EC-P7-05 — RETRY IS OFFERED ONLY FOR READS.
 *
 * "Retry" on a failed mutation is a trap: the request may have succeeded on the
 * server and failed on the way back, so retrying submits it twice. On the
 * outreach path that is a second email; on a harvest it is a second scrape.
 *
 * `onRetry` is therefore for refetching a QUERY. When a mutation fails, a list
 * must reload its state and let the user decide from what is actually there —
 * so this component takes `reloadHref` instead, and the two are mutually
 * exclusive by construction rather than by convention.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function ListError(
  props: {
    title?: string;
    detail?: string;
  } & (
    | { onRetry: () => void; reloadHref?: never }
    | { reloadHref: string; onRetry?: never }
  ),
) {
  const {
    title = "This could not be loaded",
    detail = "The request did not complete. Your data is fine — this is a display problem.",
  } = props;

  return (
    // role="alert": unlike an empty state, this appeared because something went
    // wrong and the user needs to know without discovering it.
    <Alert role="alert" tone="danger" title={title}>
      <p>{detail}</p>
      <div className="pt-2">
        {props.onRetry ? (
          <Button variant="outline" size="sm" onClick={props.onRetry}>
            Try again
          </Button>
        ) : (
          <Link
            href={props.reloadHref}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Reload this page
          </Link>
        )}
      </div>
    </Alert>
  );
}
