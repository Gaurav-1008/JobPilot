import { cn } from "@/lib/utils";

/**
 * A 0–100 match score, rendered the same way everywhere it appears.
 *
 * The bands are a shared decision rather than a per-screen one. The jobs board
 * used `>= 70` green / `> 20` neutral / else grey; ScoreCard used `>= 75`
 * success / `>= 55` warning / else danger. Same number, two different colours
 * depending on which screen you were looking at — so a job could read as "good"
 * on the board and "poor" on its own detail page.
 *
 * 55 and 75 are the thresholds kept, because they are the ones with a stated
 * meaning attached: below 55 the tailoring pass is unlikely to close the gap,
 * above 75 the resume already covers the role.
 */
export function scoreBand(score: number): "strong" | "fair" | "weak" {
  if (score >= 75) return "strong";
  if (score >= 55) return "fair";
  return "weak";
}

const BAND_TEXT = {
  strong: "text-score-strong",
  fair: "text-score-fair",
  weak: "text-score-weak",
} as const;

const BAND_TRACK = {
  strong: "bg-score-strong",
  fair: "bg-score-fair",
  weak: "bg-score-weak",
} as const;

/** Score label for anyone not reading the colour — screen readers included. */
const BAND_LABEL = {
  strong: "strong match",
  fair: "partial match",
  weak: "weak match",
} as const;

const SIZES = {
  sm: "text-base",
  md: "text-2xl",
  lg: "text-4xl",
} as const;

/**
 * `title` carries the band in words. Colour alone is not a channel — for a
 * red/green-deficient user the strong and fair bands are the same swatch, and
 * this list is ranked by exactly that number.
 */
export function ScoreValue({
  score,
  size = "md",
  className,
}: {
  score: number;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const band = scoreBand(score);
  return (
    <span
      title={`${Math.round(score)} of 100 — ${BAND_LABEL[band]}`}
      className={cn("font-semibold tabular-nums", SIZES[size], BAND_TEXT[band], className)}
    >
      {Math.round(score)}
    </span>
  );
}

/**
 * A score as a bar. Used where a column of numbers needs to be scannable
 * without reading each one.
 *
 * Not a `<progress>`: this is a measurement, not a task advancing, and the
 * semantics of `role="meter"` are what a screen reader should announce.
 */
export function ScoreBar({
  score,
  label,
  className,
}: {
  score: number;
  label: string;
  className?: string;
}) {
  const band = scoreBand(score);
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-semibold tabular-nums", BAND_TEXT[band])}>
          {Math.round(score)}
        </span>
      </div>
      <div
        role="meter"
        aria-valuenow={Math.round(score)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${Math.round(score)} of 100, ${BAND_LABEL[band]}`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-300", BAND_TRACK[band])}
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
      </div>
    </div>
  );
}
