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

import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";

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
export function ListLoading({ rows = 3, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="mt-4 space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
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
    <div className="mt-4 rounded border border-dashed border-border bg-card/40 px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{detail}</p>
      {action && (
        <Link
          href={action.href}
          className="mt-4 inline-block rounded bg-black px-4 py-2 text-sm text-white"
        >
          {action.label}
        </Link>
      )}
    </div>
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
    <div className="mt-4 rounded border border-dashed border-border bg-card/40 px-6 py-10 text-center">
      <p className="text-sm font-medium">
        None of your {total} {noun} match these filters
      </p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Nothing has been deleted — the filters are just narrower than the data.
      </p>
      <button
        onClick={onClear}
        className="mt-4 rounded border px-4 py-2 text-sm"
      >
        Clear filters
      </button>
    </div>
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
    <div
      role="alert"
      className="mt-4 rounded border border-red-300 bg-red-50 px-6 py-8 text-center"
    >
      <p className="text-sm font-medium text-red-900">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-red-900">{detail}</p>
      {props.onRetry ? (
        <button onClick={props.onRetry} className="mt-4 rounded border border-red-300 px-4 py-2 text-sm">
          Try again
        </button>
      ) : (
        <Link
          href={props.reloadHref}
          className="mt-4 inline-block rounded border border-red-300 px-4 py-2 text-sm"
        >
          Reload this page
        </Link>
      )}
    </div>
  );
}
