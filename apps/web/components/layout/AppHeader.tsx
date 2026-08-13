import Link from "next/link";
import { Wand2 } from "lucide-react";

import { getSession } from "@/lib/auth/session";
import { SignOutButton } from "@/components/SignOutButton";

/**
 * Top navigation.
 *
 * This used to hold exactly one destination — the logo — which meant every
 * screen built from Phase 2 onward (search, jobs, resumes, outreach, opt-out,
 * settings) existed and routed correctly but could not be REACHED by clicking.
 * The only way in was typing a URL, so from the outside the app still looked
 * like it did nothing but tailor a pasted resume.
 *
 * Links are session-gated rather than always shown: every destination here sits
 * behind proxy.ts's default-deny, so offering them to a signed-out visitor only
 * bounces them to sign-in. `getSession()` validates the cookie against GoTrue —
 * the same call the middleware already makes for this request.
 */
const NAV = [
  { href: "/search", label: "Search" },
  { href: "/jobs", label: "Jobs" },
  { href: "/outreach", label: "Outreach" },
  { href: "/resumes", label: "Resumes" },
  { href: "/profile", label: "Profile" },
] as const;

export async function AppHeader() {
  const session = await getSession();

  return (
    <header className="border-b border-border bg-card/60 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
        <Link
          href={session ? "/jobs" : "/"}
          className="flex shrink-0 items-center gap-2 font-semibold"
        >
          <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
            <Wand2 className="size-4" />
          </span>
          JobPilot
        </Link>

        {session ? (
          <nav className="flex items-center gap-4 overflow-x-auto text-sm">
            {NAV.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="whitespace-nowrap text-muted-foreground hover:text-foreground"
              >
                {label}
              </Link>
            ))}
            <SignOutButton />
          </nav>
        ) : (
          <nav className="flex items-center gap-4 text-sm">
            <Link
              href="/tailor"
              className="whitespace-nowrap text-muted-foreground hover:text-foreground"
            >
              Try tailoring
            </Link>
            <Link
              href="/sign-in"
              className="whitespace-nowrap text-muted-foreground hover:text-foreground"
            >
              Sign in
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
