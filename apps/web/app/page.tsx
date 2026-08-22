import Link from "next/link";
import { ArrowRight, ShieldCheck, Search, GitCompareArrows, Send } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";

/**
 * The four stages, in the order the product runs them.
 *
 * This list described the Phase 1 tool — three cards, all about tailoring a
 * pasted resume. That was accurate then and became the landing page's version
 * of a stale comment: everything it claimed was true, and it omitted three
 * quarters of what the platform does.
 */
const FEATURES = [
  {
    icon: Search,
    title: "Real jobs, harvested",
    body: "Search once and JobPilot pulls matching roles from multiple boards, deduplicates them, and fetches each description automatically — no copy-paste.",
  },
  {
    icon: GitCompareArrows,
    title: "Scored, then tailored",
    body: "Every job gets an explainable 0–100 score. Tailoring rewrites each bullet with a reason, the keywords it addressed, and a confidence level you can check.",
  },
  {
    icon: Send,
    title: "Outreach you approve",
    body: "Drafts cite the evidence your tailoring run actually found. Nothing sends without you reading it — approval is bound to the exact text.",
  },
  {
    icon: ShieldCheck,
    title: "Truthful by design",
    body: "No invented employers, degrees, or metrics. Gaps are surfaced honestly rather than papered over, and the checks run on the server.",
  },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-20 text-center">
        <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          Your whole job search, in one pipeline.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
          JobPilot harvests real listings, scores each one against your resume,
          tailors it truthfully, and drafts outreach personalized with the
          evidence the tailoring actually found — then tracks every application.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/search" className={buttonVariants({ size: "lg" })}>
            Find jobs
            <ArrowRight className="size-4" />
          </Link>
          {/* The Phase 1 entry point still works and needs no account, so it
              stays — as the secondary path rather than the only one. */}
          <Link
            href="/tailor"
            className={buttonVariants({ size: "lg", variant: "outline" })}
          >
            Just tailor a resume
          </Link>
        </div>
      </section>

      <section className="grid gap-4 pb-20 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <div
            key={title}
            className="rounded-lg border border-border bg-card p-5"
          >
            <span className="grid size-9 place-items-center rounded-md bg-accent text-accent-foreground">
              <Icon className="size-5" />
            </span>
            <h3 className="mt-3 font-semibold">{title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
