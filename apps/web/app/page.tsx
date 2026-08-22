import Link from "next/link";
import {
  ArrowRight,
  GitCompareArrows,
  Search,
  Send,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { buttonVariants } from "@/components/ui/button";

/**
 * The four stages, in the order the product runs them.
 *
 * This list described the Phase 1 tool — three cards, all about tailoring a
 * pasted resume. That was accurate then and became the landing page's version
 * of a stale comment: everything it claimed was true, and it omitted three
 * quarters of what the platform does.
 *
 * `step` is rendered as a number because these are SEQUENTIAL. As four
 * equal-weight cards in a grid they read as a feature list — four things the
 * product happens to do — which is the one thing this product is not. The
 * output of each stage is the input to the next, and that is the whole claim.
 */
const STAGES: {
  step: string;
  icon: LucideIcon;
  title: string;
  body: string;
}[] = [
  {
    step: "01",
    icon: Search,
    title: "Real jobs, harvested",
    body: "Search once and JobPilot pulls matching roles from multiple boards, deduplicates them, and fetches each description automatically — no copy-paste.",
  },
  {
    step: "02",
    icon: GitCompareArrows,
    title: "Scored, then tailored",
    body: "Every job gets an explainable 0–100 score. Tailoring rewrites each bullet with a reason, the keywords it addressed, and a confidence level you can check.",
  },
  {
    step: "03",
    icon: Send,
    title: "Outreach you approve",
    body: "Drafts cite the evidence your tailoring run actually found. Nothing sends without you reading it — approval is bound to the exact text.",
  },
  {
    step: "04",
    icon: ShieldCheck,
    title: "Truthful by design",
    body: "No invented employers, degrees, or metrics. Gaps are surfaced honestly rather than papered over, and the checks run on the server.",
  },
];

/** The specific, checkable promises — the ones a generic AI tool cannot make. */
const GUARANTEES = [
  ["Every rewrite carries a reason", "and the keywords it was aimed at."],
  ["Nothing sends unread", "approval is bound to a hash of the exact text."],
  ["Gaps stay visible", "they are reported, never written over."],
];

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      {/* ── Hero ──────────────────────────────────────────────────────────
          A single centred column at `max-w-3xl` inside the wider page: the
          heading is the only thing on screen at first paint, and a 72ch
          measure is where a display-size line stops being scannable. */}
      <section className="py-16 text-center sm:py-24">
        <span className="inline-flex items-center gap-2 rounded-full border border-border-strong bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
          <ShieldCheck className="size-3.5 text-link" aria-hidden="true" />
          Truthfulness enforced server-side
        </span>

        {/* The one place the theme's serif appears. Libre Baskerville is a
            display face here and nowhere else: it is loaded at regular weight
            only, so `font-normal` is deliberate — asking for semibold would
            have the browser synthesise it and smear the stroke contrast that is
            the entire reason to set a headline in Baskerville. Interface text
            stays in Poppins, where an x-height built for 13px belongs. */}
        <h1 className="mx-auto mt-6 max-w-3xl font-serif text-4xl font-normal tracking-tight text-balance sm:text-5xl lg:text-6xl">
          Your whole job search, in one pipeline.
        </h1>

        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground text-pretty">
          JobPilot harvests real listings, scores each one against your resume,
          tailors it truthfully, and drafts outreach personalized with the
          evidence the tailoring actually found — then tracks every application.
        </p>

        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/search"
            className={buttonVariants({ size: "lg", className: "w-full sm:w-auto" })}
          >
            Find jobs
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
          {/* The Phase 1 entry point still works and needs no account, so it
              stays — as the secondary path rather than the only one. */}
          <Link
            href="/tailor"
            className={buttonVariants({
              size: "lg",
              variant: "outline",
              className: "w-full sm:w-auto",
            })}
          >
            Just tailor a resume
          </Link>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Tailoring a pasted resume needs no account.
        </p>
      </section>

      {/* ── The pipeline ──────────────────────────────────────────────────
          Numbered and connected, not a feature grid. The connector is a
          decorative rule drawn only at `lg`, where all four sit on one row and
          the left-to-right reading actually holds; stacked on mobile it would
          point in the wrong direction. */}
      <section aria-labelledby="how" className="pb-16 sm:pb-24">
        <h2 id="how" className="sr-only">
          How JobPilot works
        </h2>

        <ol className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <span
            aria-hidden="true"
            className="absolute left-0 right-0 top-11 hidden h-px bg-border lg:block"
          />
          {STAGES.map(({ step, icon: Icon, title, body }) => (
            <li
              key={title}
              className="relative rounded-lg border border-border bg-card p-5 shadow-sm transition-colors duration-200 hover:border-border-strong"
            >
              <div className="flex items-center justify-between">
                <span
                  aria-hidden="true"
                  className="grid size-10 place-items-center rounded-md bg-primary-soft text-link"
                >
                  <Icon className="size-5" />
                </span>
                <span
                  aria-hidden="true"
                  className="font-mono text-xs font-medium text-muted-foreground"
                >
                  {step}
                </span>
              </div>
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── The guarantees ────────────────────────────────────────────────
          Three checkable statements rather than a testimonial block. This
          product has no users to quote yet, and the differentiator is a
          property of the system, which is the kind of claim a reader can go
          and verify. */}
      <section
        aria-labelledby="guarantees"
        className="mb-20 rounded-lg border border-border bg-elevated p-6 sm:p-8"
      >
        <h2 id="guarantees" className="text-lg font-semibold tracking-tight">
          What “truthful” means here, concretely
        </h2>
        <dl className="mt-5 grid gap-5 sm:grid-cols-3">
          {GUARANTEES.map(([term, detail]) => (
            <div key={term} className="flex gap-3">
              <ShieldCheck
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-link"
              />
              <div>
                <dt className="text-sm font-medium">{term}</dt>
                <dd className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                  {detail}
                </dd>
              </div>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
