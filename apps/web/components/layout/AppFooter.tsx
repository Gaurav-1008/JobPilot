/** Footer with the standing truthfulness disclaimer. */
export function AppFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-card/40">
      <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-muted-foreground">
        {/* Widened to cover outreach. Phase 5 made this app write email under
            the user's own name, so a notice that only mentions resumes now
            claims less honesty than the product actually owes. */}
        <p className="max-w-3xl">
          <strong className="text-foreground">Truthfulness notice.</strong>{" "}
          JobPilot rewrites and writes only content traceable to your resume,
          and never invents employers, degrees, metrics, or relationships.
          Everything it produces — tailored resumes and outreach alike — is a
          draft for you to check before it goes anywhere. No ATS or reply
          outcome is guaranteed.
        </p>
      </div>
    </footer>
  );
}
