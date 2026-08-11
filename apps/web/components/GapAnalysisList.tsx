import { CheckCircle2, AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { GapAnalysis, Importance } from "@/lib/schemas";

interface GapAnalysisListProps {
  gapAnalysis: GapAnalysis;
}

const IMPORTANCE_ORDER: Record<Importance, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function importanceVariant(importance: Importance) {
  if (importance === "high") return "danger" as const;
  if (importance === "medium") return "warning" as const;
  return "secondary" as const;
}

/** Sorted list of missing/weak requirements with truthfulness guidance. */
export function GapAnalysisList({ gapAnalysis }: GapAnalysisListProps) {
  const gaps = [...gapAnalysis.gaps].sort(
    (a, b) => IMPORTANCE_ORDER[a.importance] - IMPORTANCE_ORDER[b.importance],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gap analysis</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {gaps.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No significant gaps detected.
          </p>
        )}
        {gaps.map((gap) => (
          <div
            key={gap.name}
            className="rounded-md border border-border p-3 space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{gap.name}</span>
              <Badge variant={importanceVariant(gap.importance)}>
                {gap.importance}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{gap.jdEvidence}</p>
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">On resume:</span>{" "}
              {gap.resumeEvidence}
            </p>
            <div className="flex items-start gap-1.5 text-xs">
              {gap.canSafelyAdd ? (
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
              ) : (
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
              )}
              <span>{gap.suggestedAction}</span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
