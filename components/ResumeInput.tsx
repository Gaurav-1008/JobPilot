"use client";

import { useRef, useState } from "react";
import { Upload, Loader2, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { detectSections } from "@/lib/heuristic-resume";

interface ResumeInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const ACCEPT = ".pdf,.docx,.txt,.md";

/** Resume input: paste text or upload a PDF/DOCX/TXT (Phase 5). */
export function ResumeInput({ value, onChange, disabled }: ResumeInputProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [filename, setFilename] = useState<string | null>(null);

  const sections = value.trim() ? detectSections(value) : [];

  async function handleFile(file: File) {
    setUploading(true);
    setUploadError(null);
    setWarnings([]);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/upload/resume", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Upload failed");
      onChange(data.text);
      setWarnings(data.warnings ?? []);
      setFilename(file.name);
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label htmlFor="resume-input" className="text-sm font-medium">
          Your resume
        </label>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || uploading}
          onClick={() => fileRef.current?.click()}
          aria-label="Upload resume file (PDF, DOCX, or TXT)"
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          Upload PDF/DOCX
        </Button>
      </div>

      <Textarea
        id="resume-input"
        placeholder="Paste your resume text here, or upload a file…"
        value={value}
        disabled={disabled || uploading}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[240px]"
      />

      {uploadError && (
        <p className="flex items-center gap-1.5 text-xs text-danger">
          <AlertTriangle className="size-3.5 shrink-0" />
          {uploadError}
        </p>
      )}
      {warnings.map((w, i) => (
        <p key={i} className="flex items-start gap-1.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {w}
        </p>
      ))}

      <p className="text-xs text-muted-foreground">
        {filename && <>Loaded {filename} · </>}
        {value.trim().length} characters
        {sections.length > 0 && (
          <> · detected sections: {sections.map((s) => s.name).join(", ")}</>
        )}
      </p>
    </div>
  );
}
