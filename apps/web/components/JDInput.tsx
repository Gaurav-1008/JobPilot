"use client";

import { Textarea } from "@/components/ui/textarea";

interface JDInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** Pasted job-description input. */
export function JDInput({ value, onChange, disabled }: JDInputProps) {
  return (
    <div className="space-y-2">
      <label htmlFor="jd-input" className="text-sm font-medium">
        Job description
      </label>
      <Textarea
        id="jd-input"
        placeholder="Paste the job description here…"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[240px]"
      />
      <p className="text-xs text-muted-foreground">
        {value.trim().length} characters
      </p>
    </div>
  );
}
