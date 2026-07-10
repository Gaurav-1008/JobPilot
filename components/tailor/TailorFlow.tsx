"use client";

import { useState } from "react";
import { Check, Loader2, Sparkles, RotateCcw, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ResumeInput } from "@/components/ResumeInput";
import { JDInput } from "@/components/JDInput";
import { ScoreCard } from "@/components/ScoreCard";
import { JDRequirementsSummary } from "@/components/JDRequirementsSummary";
import { GapAnalysisList } from "@/components/GapAnalysisList";
import { SideBySideDiff } from "@/components/SideBySideDiff";
import { PDFExportButton } from "@/components/PDFExportButton";
import { useTailoringRun } from "@/hooks/useTailoringRun";
import { DEMO_RESUME_TEXT, DEMO_JD_TEXT } from "@/lib/sample-content";

const STEPS = ["Input", "Analysis", "Review", "Export"] as const;

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2 text-sm">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full border text-xs font-medium",
                done && "border-transparent bg-primary text-primary-foreground",
                active && "border-primary text-primary",
                !done && !active && "border-border text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span
              className={cn(
                active ? "font-medium" : "text-muted-foreground",
                "hidden sm:inline",
              )}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <span className="mx-1 h-px w-6 bg-border" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function TailorFlow() {
  const [resumeText, setResumeText] = useState("");
  const [jdText, setJdText] = useState("");
  const {
    run,
    analyze,
    tailor,
    reset,
    isAnalyzing,
    isTailoring,
    analyzeError,
    tailorError,
  } = useTailoringRun();

  const canAnalyze = resumeText.trim().length > 0 && jdText.trim().length > 0;
  const hasTailored = Boolean(run?.tailoredResume && run?.tailoredMatch);
  const currentStep = hasTailored ? 3 : run ? 2 : 0;

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <Stepper current={currentStep} />
        {run && (
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw className="size-4" />
            Start over
          </Button>
        )}
      </div>

      {/* Step 1 — Input */}
      {!run && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Paste your resume and a job description</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setResumeText(DEMO_RESUME_TEXT);
                setJdText(DEMO_JD_TEXT);
              }}
            >
              Load example
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <ResumeInput value={resumeText} onChange={setResumeText} disabled={isAnalyzing} />
            <JDInput value={jdText} onChange={setJdText} disabled={isAnalyzing} />
          </div>
          {analyzeError && <ErrorNote message={analyzeError.message} />}
          <div className="flex items-center gap-3">
            <Button onClick={() => analyze(resumeText, jdText)} disabled={!canAnalyze || isAnalyzing}>
              {isAnalyzing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Analyze
            </Button>
            {!canAnalyze && (
              <span className="text-xs text-muted-foreground">
                Both fields are required.
              </span>
            )}
          </div>
          {isAnalyzing && (
            <>
              <LoadingCaption text="Parsing resume & JD, scoring, and finding gaps…" />
              <AnalysisSkeleton />
            </>
          )}
        </section>
      )}

      {/* Step 2 — Analysis */}
      {run && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Analysis</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <JDRequirementsSummary jd={run.jobDescription} />
            <ScoreCard original={run.originalMatch} tailored={run.tailoredMatch} />
          </div>
          <GapAnalysisList gapAnalysis={run.gapAnalysis} />
          {!hasTailored && (
            <>
              {tailorError && <ErrorNote message={tailorError.message} />}
              <Button onClick={tailor} disabled={isTailoring}>
                {isTailoring ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                Generate tailored resume
              </Button>
              {isTailoring && (
                <>
                  <LoadingCaption text="Rewriting bullets role by role and re-scoring…" />
                  <AnalysisSkeleton />
                </>
              )}
            </>
          )}
        </section>
      )}

      {/* Step 3 — Review */}
      {hasTailored && run?.tailoredResume && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Side-by-side review</h2>
          {run.warnings.length > 0 && <WarningsBanner warnings={run.warnings} />}
          <SideBySideDiff tailored={run.tailoredResume} />
        </section>
      )}

      {/* Step 4 — Export */}
      {hasTailored && run && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Export</h2>
          <PDFExportButton runId={run.id} />
        </section>
      )}
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p className="flex items-center gap-2 rounded-md border border-danger/40 bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2 text-sm text-danger">
      <AlertTriangle className="size-4 shrink-0" />
      {message}
    </p>
  );
}

function WarningsBanner({ warnings }: { warnings: string[] }) {
  return (
    <Card className="border-warning/50 bg-[color-mix(in_srgb,var(--warning)_6%,transparent)]">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-warning">
          <AlertTriangle className="size-4" />
          Before you export
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function LoadingCaption({ text }: { text: string }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 text-sm text-muted-foreground"
    >
      <Loader2 className="size-4 animate-spin" />
      {text}
    </p>
  );
}

function AnalysisSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
