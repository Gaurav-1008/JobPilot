import Link from "next/link";
import { cookies } from "next/headers";
import { Wand2 } from "lucide-react";

import { AppNav } from "@/components/layout/AppNav";
import { DegradationBanner } from "@/components/layout/DegradationBanner";
import { buttonVariants } from "@/components/ui/button";

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
 * bounces them to sign-in.
 *
 * The links themselves live in AppNav, a client component, because the active
 * indicator needs `usePathname()`. This shell stays a server component so the
 * cookie read below does not have to become a client-side fetch.
 */

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
    /*
     * Sticky, because the dashboard screens are long lists and the nav is the
     * only way between them — scrolling to the bottom of 40 harvested jobs
     * should not mean scrolling back up to leave.
     *
     * `bg-card/80 + backdrop-blur` keeps the rows underneath faintly visible
     * while staying opaque enough to read against; the fallback `bg-card` in
     * `supports-` guards browsers without backdrop-filter, where the
     * translucent version renders as unreadable text over content.
     */
    <header className="sticky top-0 z-50 border-b border-border bg-card supports-[backdrop-filter]:bg-card/85 supports-[backdrop-filter]:backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        {/*
         * The logo goes HOME, signed in or not.
         *
         * It used to redirect a signed-in user to /jobs, on the usual reasoning
         * that the board is more useful to them than a marketing page. The
         * problem is that it made the home page unreachable while signed in —
         * clicking the one control every site puts there for "take me to the
         * start" silently did something else, and there was no other way back.
         *
         * Nothing is lost by changing it: "Jobs" is already a nav item two
         * pixels to the right, so the logo was a duplicate of an existing
         * destination AND the only route to a page you could otherwise not
         * open.
         */}
        <Link
          href="/"
          /* min-h-11: the logo is the "take me home" control on every screen
             and it drew at 28px — the smallest tap target in the header, and
             the one a thumb reaches for most often. The header is 56px tall,
             so 44px centres inside it without changing the layout. */
          className="flex min-h-11 shrink-0 items-center gap-2 rounded-md font-semibold tracking-tight transition-opacity hover:opacity-80"
        >
          <span
            aria-hidden="true"
            className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground shadow-sm"
          >
            <Wand2 className="size-4" />
          </span>
          JobPilot
        </Link>

        {session ? (
          <AppNav />
        ) : (
          <nav aria-label="Main" className="flex items-center gap-2">
            {/* Same destination as the landing page's secondary CTA, and for
                the same reason: /tailor is behind proxy.ts and the flow needs a
                session regardless, so sending a signed-out visitor at the tool
                itself only bounces them to the sign-in form. */}
            <Link
              href="/sign-up?next=/tailor"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              Try tailoring
            </Link>
            <Link href="/sign-in" className={buttonVariants({ size: "sm" })}>
              Sign in
            </Link>
          </nav>
        )}
      </div>

      {/* P7.2.4 — only rendered for a signed-in user. A visitor on the marketing
          page has no use for "harvesting is paused", and polling health for
          them would put load on the dependencies on behalf of someone who is
          not using them. */}
      {session && <DegradationBanner />}
    </header>
  );
}
