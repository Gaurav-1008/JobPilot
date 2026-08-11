import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Confidence, TailoredBullet } from "@/lib/schemas";

interface BulletChangeCardProps {
  bullet: TailoredBullet;
}

function confidenceVariant(confidence: Confidence) {
  if (confidence === "high") return "success" as const;
  if (confidence === "medium") return "warning" as const;
  return "danger" as const;
}

/** Per-bullet before/after with change metadata (reason, keywords, confidence). */
export function BulletChangeCard({ bullet }: BulletChangeCardProps) {
  const changed = bullet.original !== bullet.tailored;

  return (
    <div
      className={cn(
        "rounded-md border border-l-[3px] p-3 space-y-2",
        bullet.riskFlag
          ? "border-warning/50 border-l-warning bg-[color-mix(in_srgb,var(--warning)_6%,transparent)]"
          : bullet.confidence === "low"
            ? "border-danger/40 border-l-danger"
            : "border-border border-l-border",
      )}
    >
      <div className="grid gap-2 md:grid-cols-2">
        <div className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Original
          </div>
          <p className="text-sm text-muted-foreground">{bullet.original}</p>
        </div>
        <div className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Tailored
          </div>
          <p
            className={cn(
              "text-sm",
              changed && "rounded bg-accent px-1 text-accent-foreground",
            )}
          >
            {bullet.tailored}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={confidenceVariant(bullet.confidence)}>
          {bullet.confidence} confidence
        </Badge>
        {bullet.keywordsAddressed.map((kw) => (
          <Badge key={kw} variant="outline">
            {kw}
          </Badge>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Why:</span>{" "}
        {bullet.changeReason}
      </p>

      {bullet.riskFlag && (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {bullet.riskFlag}
        </p>
      )}
    </div>
  );
}
