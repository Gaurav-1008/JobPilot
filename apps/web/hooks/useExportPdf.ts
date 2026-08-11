"use client";

import { useMutation } from "@tanstack/react-query";

type PdfType = "tailored" | "comparison";

interface ExportFile {
  type: PdfType;
  filename: string;
  mimeType: string;
  base64: string;
}

/** Convert a base64 payload to a Blob and trigger a browser download. */
function downloadBase64(file: ExportFile) {
  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Request PDF export for a run and download the returned files. */
export function useExportPdf() {
  const mutation = useMutation({
    mutationFn: async (input: { runId: string; types: PdfType[] }) => {
      const res = await fetch("/api/export/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Export failed");
      return data.files as ExportFile[];
    },
    onSuccess: (files) => files.forEach(downloadBase64),
  });

  return {
    exportPdf: (runId: string, types: PdfType[]) =>
      mutation.mutate({ runId, types }),
    isExporting: mutation.isPending,
    exportError: mutation.error as Error | null,
    lastTypes: mutation.variables?.types,
  };
}
