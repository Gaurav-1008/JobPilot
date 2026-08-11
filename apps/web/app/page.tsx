import Link from "next/link";
import { ArrowRight, ShieldCheck, Target, GitCompareArrows } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";

const FEATURES = [
  {
    icon: Target,
    title: "Explainable match score",
    body: "See a 0–100 alignment score broken into skills, responsibilities, keywords, and seniority — with reasons, not just a number.",
  },
  {
    icon: GitCompareArrows,
    title: "Side-by-side rewrites",
    body: "Every bullet is rewritten with a change reason, addressed keywords, and a confidence level you can review before you trust it.",
  },
  {
    icon: ShieldCheck,
    title: "Truthful by design",
    body: "No invented employers, degrees, or metrics. Gaps are surfaced honestly instead of being papered over.",
  },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-20 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
          Phase 1 prototype · mock data
        </span>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          Tailor your resume to any job — truthfully.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
          Paste your resume and a job description. Get an explainable match
          score, an honest gap analysis, and side-by-side bullet rewrites you
          can verify.
        </p>
        <div className="mt-8">
          <Link href="/tailor" className={buttonVariants({ size: "lg" })}>
            Start tailoring
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      <section className="grid gap-4 pb-20 sm:grid-cols-3">
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
