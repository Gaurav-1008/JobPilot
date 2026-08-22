"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, Upload } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListEmpty, ListLoading } from "@/components/ui/list-state";
import { Page, PageHeader } from "@/components/ui/page";

interface ResumeRow {
  id: string;
  version: number;
  isDefault: boolean;
  originalFilename: string | null;
  createdAt: string;
}

export default function ResumesPage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  // TanStack Query rather than useEffect + setState: it owns the loading and
  // empty states, and — the reason that matters — queryClient.clear() on sign
  // out drops this cache, which is EC-P1-01.
  const { data: rows, isPending } = useQuery<ResumeRow[]>({
    queryKey: ["resumes"],
    queryFn: async () => (await (await fetch("/api/resumes")).json()).resumes ?? [],
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["resumes"] });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/resumes", { method: "POST", body: form });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message ?? "Upload failed.");
      return d as { version: number; warnings?: string[] };
    },
    onSuccess: (d) => {
      setIsError(false);
      setMsg(d.warnings?.length
        ? `Saved as v${d.version}. ${d.warnings.join(" ")}`
        : `Saved as v${d.version}.`);
      void refresh();
    },
    // Extraction failures carry an actionable message pointing at paste.
    onError: (e: Error) => { setIsError(true); setMsg(e.message); },
  });

  function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMsg(null);
    uploadMutation.mutate(file);
  }

  async function makeDefault(id: string) {
    await fetch(`/api/resumes/${id}/default`, { method: "POST" });
    void refresh();
  }

  async function remove(id: string) {
    const res = await fetch(`/api/resumes/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setIsError(true);
      setMsg((await res.json().catch(() => ({}))).message ?? "Could not delete.");
    }
    void refresh();
  }

  const busy = uploadMutation.isPending;

  return (
    <Page width="content">
      <PageHeader
        title="Resumes"
        description="Upload once. The default is what gets scored against jobs."
      />

      <div className="mt-8 space-y-3">
        {/*
         * A file input has no styleable button, so the control is a label with
         * the input hidden inside it. `cursor-pointer` and the min height are
         * explicit because a label is not a button and inherits neither.
         */}
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-card px-4 text-sm font-medium shadow-sm transition-colors hover:bg-muted focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[color:var(--ring)]">
          <Upload className="size-4" aria-hidden="true" />
          {busy ? "Parsing…" : "Upload PDF, DOCX, or TXT"}
          <input
            type="file" accept=".pdf,.docx,.txt" onChange={upload}
            disabled={busy} className="sr-only"
          />
        </label>

        {msg && (
          <Alert role="status" tone={isError ? "danger" : "success"}>
            {msg}
          </Alert>
        )}
      </div>

      {/* Three distinct states, never shared: loading, empty, populated
          (EC-P7-01). A shared component makes a slow query look like no data. */}
      {isPending ? (
        <ListLoading rows={3} label="Loading your resumes" className="mt-8" />
      ) : !rows || rows.length === 0 ? (
        <div className="mt-8">
          <ListEmpty
            title="No resumes yet"
            detail="Upload one to get started — it becomes your default, and every job on the board is scored against it."
          />
        </div>
      ) : (
        <ul className="mt-8 space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 shadow-sm"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">v{r.version}</span>
                  {r.isDefault && <Badge variant="accent">default</Badge>}
                </div>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {r.originalFilename ?? "pasted"} ·{" "}
                  {new Date(r.createdAt).toLocaleDateString()}
                </p>
              </div>

              <div className="flex shrink-0 gap-2">
                {!r.isDefault && (
                  <Button variant="outline" size="sm" onClick={() => makeDefault(r.id)}>
                    Make default
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => remove(r.id)}
                  aria-label={`Delete resume v${r.version}`}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
