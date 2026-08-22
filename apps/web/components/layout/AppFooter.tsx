import { ShieldCheck } from "lucide-react";

/** Footer with the standing truthfulness disclaimer. */
export function AppFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-card/40">
      <div className="mx-auto flex max-w-6xl gap-3 px-4 py-8 sm:px-6">
        <ShieldCheck
          aria-hidden="true"
          className="mt-0.5 hidden size-4 shrink-0 text-muted-foreground sm:block"
        />
        {/* Widened to cover outreach. Phase 5 made this app write email under
            the user's own name, so a notice that only mentions resumes now
            claims less honesty than the product actually owes. */}
        <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
          <strong className="font-semibold text-foreground">
            Truthfulness notice.
          </strong>{" "}
          JobPilot rewrites and writes only content traceable to your resume, and
          never invents employers, degrees, metrics, or relationships. Everything
          it produces — tailored resumes and outreach alike — is a draft for you
          to check before it goes anywhere. No ATS or reply outcome is
          guaranteed.
        </p>
      </div>
    </footer>
  );
}
