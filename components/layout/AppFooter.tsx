/** Footer with the standing truthfulness disclaimer. */
export function AppFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-card/40">
      <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-muted-foreground">
        <p className="max-w-3xl">
          <strong className="text-foreground">Truthfulness notice.</strong>{" "}
          Resume Shapeshifter rewrites only content traceable to your resume and
          never invents employers, degrees, or metrics. Generated output is a
          draft — verify every claim before submitting. No ATS outcome is
          guaranteed.
        </p>
        <p className="mt-2"></p>
      </div>
    </footer>
  );
}
