"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

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
      setMsg(d.warnings?.length
        ? `Saved as v${d.version}. ${d.warnings.join(" ")}`
        : `Saved as v${d.version}.`);
      void refresh();
    },
    // Extraction failures carry an actionable message pointing at paste.
    onError: (e: Error) => setMsg(e.message),
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
    if (!res.ok) setMsg((await res.json().catch(() => ({}))).message ?? "Could not delete.");
    void refresh();
  }

  const busy = uploadMutation.isPending;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Resumes</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Upload once. The default is what gets scored against jobs.
      </p>

      <div className="mt-6">
        <label className="inline-block cursor-pointer rounded border px-4 py-2 text-sm">
          {busy ? "Parsing…" : "Upload PDF, DOCX, or TXT"}
          <input
            type="file" accept=".pdf,.docx,.txt" onChange={upload}
            disabled={busy} className="hidden"
          />
        </label>
        {msg && <p role="status" className="mt-3 text-sm text-neutral-700">{msg}</p>}
      </div>

      {/* Three distinct states, never shared: loading, empty, populated
          (EC-P7-01). A shared component makes a slow query look like no data. */}
      {isPending ? (
        <p className="mt-8 text-sm text-neutral-500">Loading…</p>
      ) : !rows || rows.length === 0 ? (
        <p className="mt-8 text-sm text-neutral-500">
          No resumes yet. Upload one to get started.
        </p>
      ) : (
        <ul className="mt-8 divide-y rounded border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <span className="font-medium">v{r.version}</span>
                {r.isDefault && (
                  <span className="ml-2 rounded bg-black px-2 py-0.5 text-xs text-white">
                    default
                  </span>
                )}
                <div className="text-sm text-neutral-500">
                  {r.originalFilename ?? "pasted"} ·{" "}
                  {new Date(r.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div className="flex gap-2">
                {!r.isDefault && (
                  <button
                    onClick={() => makeDefault(r.id)}
                    className="rounded border px-3 py-1 text-sm"
                  >
                    Make default
                  </button>
                )}
                <button
                  onClick={() => remove(r.id)}
                  className="rounded border px-3 py-1 text-sm text-red-600"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
