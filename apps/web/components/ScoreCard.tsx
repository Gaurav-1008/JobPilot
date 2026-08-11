import { ArrowRight, TrendingUp } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { MatchScore } from "@/lib/schemas";

interface ScoreCardProps {
  original: MatchScore;
  tailored?: MatchScore | null;
}

function scoreColor(score: number): string {
  if (score >= 75) return "text-success";
  if (score >= 55) return "text-warning";
  return "text-danger";
}

function ScoreDial({ label, score }: { label: string; score: number }) {
  return (
    <div className="text-center">
      <div className={cn("text-4xl font-bold tabular-nums", scoreColor(score))}>
        {Math.round(score)}
      </div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

const SUBSCORES: Array<{ key: keyof MatchScore; label: string }> = [
  { key: "skillCoverageScore", label: "Skill coverage" },
  { key: "responsibilityAlignmentScore", label: "Responsibilities" },
  { key: "keywordScore", label: "Keywords" },
  { key: "seniorityScore", label: "Seniority" },
];

/** Original vs tailored match score with explainable sub-scores. */
export function ScoreCard({ original, tailored }: ScoreCardProps) {
  const active = tailored ?? original;
  const delta = tailored ? tailored.overallScore - original.overallScore : 0;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Match score</CardTitle>
        {tailored && delta !== 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--success)_15%,transparent)] px-2 py-0.5 text-xs font-medium text-success">
            <TrendingUp className="size-3" />
            {delta > 0 ? "+" : ""}
            {delta} pts
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-center gap-6">
          <ScoreDial label="Original" score={original.overallScore} />
          {tailored && (
            <>
              <ArrowRight className="size-5 text-muted-foreground" />
              <ScoreDial label="Tailored" score={tailored.overallScore} />
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SUBSCORES.map(({ key, label }) => (
            <div
              key={key}
              className="rounded-md border border-border bg-muted/40 p-2 text-center"
            >
              <div
                className={cn(
                  "text-lg font-semibold tabular-nums",
                  scoreColor(active[key] as number),
                )}
              >
                {Math.round(active[key] as number)}
              </div>
              <div className="text-[11px] text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>

        <p className="text-sm text-muted-foreground">{active.explanation}</p>

        {active.criticalMissingRequirements.length > 0 && (
          <p className="text-xs text-danger">
            Critical gaps still open:{" "}
            {active.criticalMissingRequirements.join(", ")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
