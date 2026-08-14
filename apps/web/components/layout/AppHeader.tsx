import Link from "next/link";
import { cookies } from "next/headers";
import { Wand2 } from "lucide-react";

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
  { href: "/tracker", label: "Tracker" },
  { href: "/resumes", label: "Resumes" },
  { href: "/profile", label: "Profile" },
] as const;

/**
 * Is a session cookie present? A COOKIE READ, NOT AN AUTH CALL.
 *
 * The first version of this called `getSession()`, which round-trips to GoTrue
 * to validate the JWT. Because the header sits in the root layout, that ran on
 * every page render — on top of the identical call proxy.ts already makes for
 * the same request. It doubled auth traffic per navigation and promptly earned
 * `AuthApiError: Request rate limit reached` from Supabase, which then makes
 * genuine sign-in fail. A nav bar is not worth a rate limit.
 *
 * Cookie presence is the right signal here because this decision is COSMETIC:
 * it picks which links to draw. It grants nothing. Every destination is behind
 * proxy.ts's default-deny and its own `requireSession()`, so a forged cookie
 * buys a menu and a redirect, nothing more. Validation belongs on the paths
 * that actually hand out data — and it is still there.
 */
async function hasSessionCookie(): Promise<boolean> {
  const store = await cookies();
  // @supabase/ssr writes `sb-<project-ref>-auth-token`, sometimes chunked
  // across `.0`, `.1`, … so match the shape rather than an exact name.
  return store
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token") && c.value);
}

export async function AppHeader() {
  const session = await hasSessionCookie();

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
