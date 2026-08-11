"use client";

import { useState } from "react";
import { FileDown, GitCompareArrows, Loader2, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useExportPdf } from "@/hooks/useExportPdf";

interface PDFExportButtonProps {
  runId: string;
}

/**
 * Export step: download the tailored resume PDF and the side-by-side comparison
 * PDF. Export is gated behind an explicit truthfulness acknowledgment (§7.2).
 */
export function PDFExportButton({ runId }: PDFExportButtonProps) {
  const { exportPdf, isExporting, exportError, lastTypes } = useExportPdf();
  const [verified, setVerified] = useState(false);
  const disabled = isExporting || !verified;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Export your proof</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Download a clean, ATS-friendly tailored resume and a side-by-side
          comparison PDF (scores, requirements, bullet diffs, and gaps) — your
          portfolio proof artifact.
        </p>

        <label className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
          <Checkbox
            checked={verified}
            onChange={(e) => setVerified(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            I have reviewed the tailored content and verified that every claim is
            truthful and supported by my real experience.
          </span>
        </label>

        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => exportPdf(runId, ["tailored"])}
            disabled={disabled}
          >
            {isExporting && lastTypes?.length === 1 ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileDown className="size-4" />
            )}
            Tailored resume PDF
          </Button>
          <Button
            variant="outline"
            onClick={() => exportPdf(runId, ["comparison"])}
            disabled={disabled}
          >
            {isExporting &&
            lastTypes?.length === 1 &&
            lastTypes[0] === "comparison" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <GitCompareArrows className="size-4" />
            )}
            Comparison PDF
          </Button>
          <Button
            variant="secondary"
            onClick={() => exportPdf(runId, ["tailored", "comparison"])}
            disabled={disabled}
          >
            {isExporting && (lastTypes?.length ?? 0) > 1 ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileDown className="size-4" />
            )}
            Both
          </Button>
        </div>

        {exportError && (
          <p className="flex items-center gap-2 text-sm text-danger">
            <AlertTriangle className="size-4 shrink-0" />
            {exportError.message}
          </p>
        )}

        <p className="rounded-md border border-warning/40 bg-[color-mix(in_srgb,var(--warning)_6%,transparent)] p-3 text-xs text-muted-foreground">
          <strong className="text-foreground">Before you submit:</strong> this
          output is a draft derived from your resume. Verify every claim — no
          content is guaranteed accurate and no ATS outcome is promised.
        </p>
      </CardContent>
    </Card>
  );
}
