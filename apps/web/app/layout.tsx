import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { Providers } from "@/components/providers";
import { AppHeader } from "@/components/layout/AppHeader";
import { AppFooter } from "@/components/layout/AppFooter";

/*
 * Geist stays, over the Fira Sans / Fira Code pairing the dashboard style
 * usually calls for. Geist Sans is the same category of face — a neo-grotesque
 * with a tall x-height and unambiguous 1/l/I — and Geist Mono covers the
 * monospaced slots (email bodies, provider ids, pasted JDs). Swapping would add
 * a second font-family download to every page load in exchange for a
 * difference nobody would name.
 */
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "JobPilot",
  description:
    "Find roles, tailor truthfully, and write outreach you can verify line by line.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>
          {/*
           * Skip link. The header carries seven destinations, and without this
           * a keyboard user tabs through all of them on every single page
           * before reaching the content — on the jobs board that is seven tabs
           * before the first row.
           *
           * Visually hidden until focused rather than hidden outright:
           * `display:none` would take it out of the focus order and it would do
           * nothing at all.
           */}
          <a
            href="#main"
            className="sr-only rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[60] focus:inline-flex focus:min-h-11 focus:items-center"
          >
            Skip to content
          </a>
          <AppHeader />
          <main id="main" className="flex-1">
            {children}
          </main>
          <AppFooter />
        </Providers>
      </body>
    </html>
  );
}
