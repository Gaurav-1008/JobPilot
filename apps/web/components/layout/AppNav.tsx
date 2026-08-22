"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Briefcase,
  FileText,
  LayoutList,
  Menu,
  Search,
  Send,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";

import { SignOutButton } from "@/components/SignOutButton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/search", label: "Search", icon: Search },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/outreach", label: "Outreach", icon: Send },
  { href: "/tracker", label: "Tracker", icon: LayoutList },
  { href: "/resumes", label: "Resumes", icon: FileText },
  { href: "/profile", label: "Profile", icon: UserRound },
];

/**
 * Is this nav item the section the user is currently in?
 *
 * Prefix-matched, not equality-matched, so `/jobs/abc123` and
 * `/tracker/abc123/` still light up their parent. Equality would mean the
 * indicator switches off the moment you open a detail page — which is exactly
 * when knowing where you are is most useful.
 *
 * The `/` guard stops `/jobs` matching a hypothetical `/jobsearch`.
 */
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Signed-in navigation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TWO THINGS THIS FIXES.
 *
 * 1. NO ACTIVE STATE. Six identical grey links, and the current page looked
 *    exactly like the other five. On an app whose screens are all lists of
 *    similar-looking rows — jobs, tracker, outreach — "which one am I on?" was
 *    genuinely ambiguous, and the only answer was the URL bar.
 *
 * 2. NO MOBILE TREATMENT. Six links plus Sign out were laid out in a single
 *    `overflow-x-auto` row. At 375px that is a horizontally scrolling strip
 *    with the last two destinations off-screen and nothing indicating they are
 *    there — a scrollbar does not render on touch until you already scroll.
 *    Below `md` this is now a disclosure button and a sheet.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function AppNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Escape closes it, and the body cannot scroll behind it — a fixed overlay
  // that lets the page underneath move is disorienting on touch.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      {/* ── Desktop ─────────────────────────────────────────────────────── */}
      <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
        {NAV.map(({ href, label }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {label}
            </Link>
          );
        })}
        <span aria-hidden="true" className="mx-2 h-5 w-px bg-border" />
        <SignOutButton />
      </nav>

      {/* ── Mobile trigger ──────────────────────────────────────────────── */}
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-expanded={open}
        aria-controls="mobile-nav"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </Button>

      {/* ── Mobile sheet ────────────────────────────────────────────────── */}
      {open && (
        <div className="fixed inset-0 top-14 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-foreground/20 backdrop-blur-sm"
          />
          <nav
            id="mobile-nav"
            aria-label="Main"
            className="relative max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-b border-border bg-card p-3 shadow-lg"
          >
            <ul className="space-y-1">
              {NAV.map(({ href, label, icon: Icon }) => {
                const active = isActive(pathname, href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      /*
                       * Closed here rather than from a `useEffect` on
                       * `pathname`. Reacting to the path is both a cascading
                       * render and subtly wrong: tapping the link for the page
                       * you are already on does not change `pathname`, so the
                       * effect never fires and the sheet stays open over the
                       * page the user just asked for. The tap is the event
                       * that should close it, so it closes on the tap.
                       */
                      onClick={() => setOpen(false)}
                      className={cn(
                        // min-h-12 rather than padding alone: these are the
                        // app's primary destinations and they are being tapped
                        // with a thumb.
                        "flex min-h-12 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
                        active
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 border-t border-border pt-3">
              <SignOutButton />
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
